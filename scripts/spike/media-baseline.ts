import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

export type TranscriptCue = {
  start: number;
  end: number;
  text: string;
};

export type SpikeResult = {
  bvid: string;
  started_at: string;
  tools: { yt_dlp: boolean; ffmpeg: boolean; ocr: boolean };
  source: { metadata: 'pass' | 'fail'; transcript: 'pass' | 'fail'; video: 'pass' | 'fail' };
  transcript_cues: number;
  fixed_windows: number;
  semantic_boundaries: number;
  frame_candidates: number;
  selected_frames: number;
  comparisons: {
    scene_only: string;
    frame_difference_only: string;
    semantic_visual_ocr: string;
  };
  observations: string[];
  stop_reason?: string;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type SemanticSegment = {
  start: number;
  end: number;
  text: string;
};

const MAX_ATTEMPTS = 3;
const SAMPLE_SECONDS = 30;
const FRAME_INTERVAL_SECONDS = 5;
const BILI_USER_AGENT = 'Mozilla/5.0';

export function buildYtDlpArgs(args: string[]): string[] {
  return [
    '--proxy', '',
    '--add-header', `User-Agent: ${BILI_USER_AGENT}`,
    '--add-header', 'Referer: https://www.bilibili.com/',
    ...args,
  ];
}

const runProcess = (command: string, args: string[], cwd?: string): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

export function sanitizeBvid(raw: string): string {
  const bvid = raw.trim();
  if (!/^BV[0-9A-Za-z]+$/.test(bvid)) {
    throw new Error('Invalid BVID');
  }
  return bvid;
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return null;
  const [, hours = '0', minutes, seconds, milliseconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

function decodeVttText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVtt(input: string): TranscriptCue[] {
  const lines = input.replace(/\r/g, '').split('\n');
  const cues: TranscriptCue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index]?.match(
      /((?:(?:\d+):)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:(?:\d+):)?\d{2}:\d{2}[.,]\d{3})/,
    );
    if (!timing) continue;

    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    if (start === null || end === null || end <= start) continue;

    const textLines: string[] = [];
    for (let textIndex = index + 1; textIndex < lines.length; textIndex += 1) {
      const line = lines[textIndex] ?? '';
      if (!line.trim()) break;
      if (line.includes('-->')) break;
      textLines.push(line);
    }

    const text = decodeVttText(textLines.join(' '));
    if (text) cues.push({ start, end, text });
  }

  return cues;
}

function extractJsonRecord(output: string): Record<string, unknown> | null {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
    } catch {
      // yt-dlp may emit a progress line before its JSON record.
    }
  }
  return null;
}

function safeObservationText(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '[url omitted]').replace(/[\r\n]+/g, ' ').slice(0, 220);
}

async function withRetries<T>(stage: string, observations: string[], work: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        observations.push(`${stage}: unavailable after ${MAX_ATTEMPTS} attempts`);
        return null;
      }
    }
  }
  return null;
}

async function listFiles(directory: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension)))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function buildFixedWindows(cues: TranscriptCue[], windowSeconds: number): number {
  return new Set(cues.map((cue) => Math.floor(cue.start / windowSeconds))).size;
}

function buildSemanticSegments(cues: TranscriptCue[]): SemanticSegment[] {
  if (cues.length === 0) return [];
  const segments: SemanticSegment[] = [];
  let current: SemanticSegment = { start: cues[0]!.start, end: cues[0]!.end, text: cues[0]!.text };

  for (const cue of cues.slice(1)) {
    const gap = cue.start - current.end;
    const closesThought = /[.!?。！？：:]$/.test(current.text);
    if (gap >= 2.5 || closesThought) {
      segments.push(current);
      current = { start: cue.start, end: cue.end, text: cue.text };
    } else {
      current.end = cue.end;
      current.text = `${current.text} ${cue.text}`.trim();
    }
  }
  segments.push(current);
  return segments;
}

async function imageDifference(firstPath: string, secondPath: string): Promise<number> {
  const first = await sharp(firstPath).resize(320, 180, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const second = await sharp(secondPath).resize(320, 180, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const diff = Buffer.alloc(first.data.length);
  const changed = pixelmatch(
    first.data,
    second.data,
    diff,
    first.info.width,
    first.info.height,
    { threshold: 0.1 },
  );
  return changed / (first.info.width * first.info.height);
}

export async function extractOcrText(imagePath: string): Promise<string> {
  const tesseract = await import('tesseract.js');
  const worker = await tesseract.createWorker('eng');
  try {
    const result = await worker.recognize(imagePath);
    return result.data.text.replace(/\s+/g, ' ').trim();
  } finally {
    await worker.terminate();
  }
}

function createResult(bvid: string, startedAt: string): SpikeResult {
  return {
    bvid,
    started_at: startedAt,
    tools: { yt_dlp: false, ffmpeg: Boolean(ffmpegPath), ocr: false },
    source: { metadata: 'fail', transcript: 'fail', video: 'fail' },
    transcript_cues: 0,
    fixed_windows: 0,
    semantic_boundaries: 0,
    frame_candidates: 0,
    selected_frames: 0,
    comparisons: {
      scene_only: 'not run',
      frame_difference_only: 'not run',
      semantic_visual_ocr: 'not run',
    },
    observations: [],
  };
}

async function runSpike(bvid: string): Promise<SpikeResult> {
  const startedAt = new Date().toISOString();
  const result = createResult(bvid, startedAt);
  const workDirectory = await mkdtemp(join(tmpdir(), 'learning-workflow-spike-'));

  try {
    const ytDlpCheck = await runProcess('python', ['-m', 'yt_dlp', '--version']);
    result.tools.yt_dlp = ytDlpCheck.code === 0;
    result.tools.ocr = await import('tesseract.js').then((module) => typeof module.createWorker === 'function').catch(() => false);
    if (!result.tools.yt_dlp) {
      result.stop_reason = 'tool_unavailable: python -m yt_dlp';
      result.observations.push('Install yt-dlp in the local environment, then rerun the same BVID.');
      return result;
    }
    if (!result.tools.ffmpeg) {
      result.stop_reason = 'tool_unavailable: ffmpeg-static';
      return result;
    }

    const sourceUrl = `https://www.bilibili.com/video/${bvid}`;
    const metadata = await withRetries('metadata', result.observations, async () => {
      const command = await runProcess('python', ['-m', 'yt_dlp', ...buildYtDlpArgs([
        '--dump-single-json',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs', 'all',
        '--skip-download',
        '--no-playlist',
        '--quiet',
        '--output', join(workDirectory, '%(id)s.%(ext)s'),
        sourceUrl,
      ])], workDirectory);
      if (command.code !== 0) throw new Error('metadata command failed');
      const record = extractJsonRecord(command.stdout);
      if (!record) throw new Error('metadata JSON missing');
      return record;
    });
    if (!metadata) {
      result.stop_reason = 'source_unavailable: metadata';
      return result;
    }
    result.source.metadata = 'pass';
    const subtitleTracks = [metadata.subtitles, metadata.automatic_captions]
      .filter((tracks) => tracks && typeof tracks === 'object').length;
    result.observations.push(`metadata: public record found; subtitle track groups=${subtitleTracks}`);

    const transcript = await withRetries('transcript', result.observations, async () => {
      const subtitleFiles = await listFiles(workDirectory, ['.vtt', '.srt']);
      if (subtitleFiles.length === 0) throw new Error('timestamped subtitle file missing');
      const contents = await Promise.all(subtitleFiles.map((file) => readFile(file, 'utf8')));
      const cues = contents.flatMap((content) => parseVtt(content)).sort((a, b) => a.start - b.start);
      if (cues.length === 0) throw new Error('subtitle cues missing');
      return cues;
    });
    if (!transcript) {
      result.stop_reason = 'source_unavailable: timestamped transcript';
      return result;
    }
    result.source.transcript = 'pass';
    result.transcript_cues = transcript.length;
    result.fixed_windows = buildFixedWindows(transcript, 10);
    const semanticSegments = buildSemanticSegments(transcript);
    result.semantic_boundaries = Math.max(0, semanticSegments.length - 1);
    const firstSegment = semanticSegments[0];
    if (firstSegment) {
      result.observations.push(
        `semantic_segment: ${firstSegment.start.toFixed(1)}-${firstSegment.end.toFixed(1)}s ${safeObservationText(firstSegment.text)}`,
      );
    }

    const videoPath = await withRetries('video sample', result.observations, async () => {
      const command = await runProcess('python', ['-m', 'yt_dlp', ...buildYtDlpArgs([
        '--format', 'bv*[height<=720]+ba/b[height<=720]/b',
        '--merge-output-format', 'mp4',
        '--download-sections', '*0-30',
        '--force-keyframes-at-cuts',
        '--ffmpeg-location', dirname(ffmpegPath!),
        '--no-playlist',
        '--quiet',
        '--output', join(workDirectory, 'sample.%(ext)s'),
        sourceUrl,
      ])], workDirectory);
      if (command.code !== 0) throw new Error('bounded video download failed');
      const candidates = await listFiles(workDirectory, ['.mp4', '.mkv', '.webm']);
      const sample = candidates[0];
      if (!sample) throw new Error('bounded video sample missing');
      return sample;
    });
    if (!videoPath) {
      result.stop_reason = 'source_unavailable: bounded video sample';
      return result;
    }
    result.source.video = 'pass';

    const framePattern = join(workDirectory, 'frame-%02d.jpg');
    const frameExtraction = await withRetries('frame extraction', result.observations, async () => {
      const command = await runProcess(ffmpegPath!, [
        '-hide_banner', '-loglevel', 'error', '-ss', '0', '-t', String(SAMPLE_SECONDS),
        '-i', videoPath, '-vf', `fps=1/${FRAME_INTERVAL_SECONDS},scale=640:-2`,
        '-frames:v', '6', '-q:v', '3', '-y', framePattern,
      ], workDirectory);
      if (command.code !== 0) throw new Error('frame extraction failed');
      const frames = await listFiles(workDirectory, ['.jpg']);
      if (frames.length === 0) throw new Error('frame set empty');
      return frames;
    });
    if (!frameExtraction) {
      result.stop_reason = 'processing_unavailable: frame extraction';
      return result;
    }
    result.frame_candidates = frameExtraction.length;

    const scenePattern = join(workDirectory, 'scene-%02d.jpg');
    const sceneRun = await runProcess(ffmpegPath!, [
      '-hide_banner', '-loglevel', 'error', '-ss', '0', '-t', String(SAMPLE_SECONDS),
      '-i', videoPath, '-vf', "select='gt(scene,0.20)',scale=640:-2", '-vsync', 'vfr',
      '-frames:v', '6', '-q:v', '3', '-y', scenePattern,
    ], workDirectory);
    const sceneFrames = sceneRun.code === 0 ? await listFiles(workDirectory, ['.jpg']).then((files) => files.filter((file) => file.includes('scene-'))) : [];
    result.comparisons.scene_only = `candidate frames=${sceneFrames.length}; threshold=0.20`;

    const differences: number[] = [];
    for (let index = 1; index < frameExtraction.length; index += 1) {
      const previous = frameExtraction[index - 1];
      const current = frameExtraction[index];
      if (!previous || !current) continue;
      differences.push(await imageDifference(previous, current));
    }
    const changedFrames = differences.filter((difference) => difference >= 0.08).length;
    result.comparisons.frame_difference_only = `changed transitions=${changedFrames}/${differences.length}; threshold=0.08`;

    const semanticFrameIndexes = new Set<number>();
    for (const segment of semanticSegments.slice(0, 3)) {
      const nearestIndex = Math.max(0, Math.min(
        frameExtraction.length - 1,
        Math.round(segment.start / FRAME_INTERVAL_SECONDS),
      ));
      semanticFrameIndexes.add(nearestIndex);
    }
    const semanticFrames = [...semanticFrameIndexes]
      .map((index) => frameExtraction[index])
      .filter((file): file is string => Boolean(file));
    let ocrHits = 0;
    for (const frame of semanticFrames.slice(0, 2)) {
      try {
        const text = await Promise.race([
          extractOcrText(frame),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 20_000)),
        ]);
        if (text) ocrHits += 1;
      } catch {
        // OCR is an optional signal; the comparison remains inspectable if it is unavailable.
      }
    }
    result.selected_frames = semanticFrames.length;
    result.comparisons.semantic_visual_ocr = `semantic frames=${semanticFrames.length}; OCR text hits=${ocrHits}; boundary-nearest selection`;
    result.observations.push(`source frames: ${frameExtraction.length} sampled at ${FRAME_INTERVAL_SECONDS}s intervals`);
    return result;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const bvidIndex = process.argv.findIndex((argument) => argument === '--bvid');
  const rawBvid = bvidIndex >= 0 ? process.argv[bvidIndex + 1] : undefined;
  if (!rawBvid) {
    throw new Error('Usage: npm run spike:media -- --bvid BVxxxxxxxxxxxxxxxxxxxxxxxx');
  }

  const bvid = sanitizeBvid(rawBvid);
  const result = await runSpike(bvid);
  const outputPath = join(process.cwd(), 'experiments', `2026-09-17-${bvid}.json`);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'media spike failed'}\n`);
    process.exitCode = 1;
  });
}
