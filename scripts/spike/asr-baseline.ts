import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadAsrConfig, type AsrConfig } from '../../src/app/config';
import { createAsrWorkerClient } from '../../src/video/asr/worker-client';

export type AsrSpikeRecord = {
  model: string;
  device: string;
  first_elapsed_ms: number | null;
  second_elapsed_ms: number | null;
  first_cue_count: number | null;
  second_cue_count: number | null;
  failure_stage: string | null;
};

type AsrSpikeMeasurement = {
  model: string;
  device: string;
  firstElapsedMs: number | null;
  secondElapsedMs: number | null;
  firstCueCount: number | null;
  secondCueCount: number | null;
  failureStage: string | null;
};

export function parseAudioArgument(argumentsList: string[]): string | null {
  const index = argumentsList.findIndex((argument) => argument === '--audio');
  const value = index >= 0 ? argumentsList[index + 1] : undefined;
  return value?.trim() || null;
}

function sanitizeModelIdentifier(value: string): string {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) {
    return value.split(/[\\/]/).pop() || 'local-model';
  }
  return value;
}

export function buildAsrSpikeRecord(measurement: AsrSpikeMeasurement): AsrSpikeRecord {
  return {
    model: sanitizeModelIdentifier(measurement.model),
    device: measurement.device,
    first_elapsed_ms: measurement.firstElapsedMs === null ? null : Math.round(measurement.firstElapsedMs),
    second_elapsed_ms: measurement.secondElapsedMs === null ? null : Math.round(measurement.secondElapsedMs),
    first_cue_count: measurement.firstCueCount,
    second_cue_count: measurement.secondCueCount,
    failure_stage: measurement.failureStage,
  };
}

function defaultMeasurement(): AsrSpikeMeasurement {
  return {
    model: process.env.ASR_MODEL?.trim() || 'Qwen/Qwen3-ASR-0.6B',
    device: process.env.ASR_DEVICE?.trim() || 'auto',
    firstElapsedMs: null,
    secondElapsedMs: null,
    firstCueCount: null,
    secondCueCount: null,
    failureStage: null,
  };
}

function workerPath(): string {
  return fileURLToPath(new URL('../asr/qwen_worker.py', import.meta.url));
}

function clientConfig(config: Extract<AsrConfig, { enabled: true }>) {
  return {
    python: config.python,
    workerPath: workerPath(),
    model: config.model,
    aligner: config.aligner,
    language: config.language,
    device: config.device,
    timeoutMs: config.timeoutMs,
  } as const;
}

export async function runAsrSpike(audioPath: string): Promise<AsrSpikeRecord> {
  const measurement = defaultMeasurement();
  let config: Extract<AsrConfig, { enabled: true }>;
  try {
    const loaded = loadAsrConfig();
    if (!loaded.enabled) {
      measurement.failureStage = 'config';
      return buildAsrSpikeRecord(measurement);
    }
    config = loaded;
    measurement.model = config.model;
    measurement.device = config.device;
  } catch {
    measurement.failureStage = 'config';
    return buildAsrSpikeRecord(measurement);
  }

  try {
    const info = await stat(audioPath);
    if (!info.isFile()) {
      measurement.failureStage = 'audio';
      return buildAsrSpikeRecord(measurement);
    }
  } catch {
    measurement.failureStage = 'audio';
    return buildAsrSpikeRecord(measurement);
  }

  const client = createAsrWorkerClient(clientConfig(config));
  try {
    try {
      const firstStarted = performance.now();
      const first = await client.transcribe({ audioPath, language: config.language });
      measurement.firstElapsedMs = performance.now() - firstStarted;
      measurement.firstCueCount = first.length;
    } catch {
      measurement.failureStage = 'first_transcription';
      return buildAsrSpikeRecord(measurement);
    }

    try {
      const secondStarted = performance.now();
      const second = await client.transcribe({ audioPath, language: config.language });
      measurement.secondElapsedMs = performance.now() - secondStarted;
      measurement.secondCueCount = second.length;
    } catch {
      measurement.failureStage = 'second_transcription';
    }
    return buildAsrSpikeRecord(measurement);
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  const audioPath = parseAudioArgument(process.argv);
  if (!audioPath) {
    throw new Error('Usage: npm run spike:asr -- --audio <local-audio-path>');
  }

  const record = await runAsrSpike(audioPath);
  const outputPath = join(process.cwd(), 'experiments', '2026-09-19-asr-baseline.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  if (record.failure_stage) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'ASR spike failed'}\n`);
    process.exitCode = 1;
  });
}
