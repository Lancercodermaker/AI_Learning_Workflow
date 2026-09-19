import { spawn, type SpawnOptions } from 'node:child_process';
import { PipelineError } from '../../domain/errors';
import { normalizeTranscript } from '../transcript/normalize';
import { parseAsrWorkerLine } from './protocol';
import type { AsrWorkerRequest, AsrWorkerResponse } from './types';

export type AsrWorkerProcess = {
  stdin: { write(value: string): boolean; end(): void };
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
  on(event: 'error' | 'exit' | 'close', listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
};

export type AsrWorkerClientConfig = {
  python: string;
  workerPath: string;
  model: string;
  aligner: string;
  language: string;
  device: 'auto' | 'cpu' | 'cuda:0';
  timeoutMs: number;
};

export type AsrWorkerClientDependencies = {
  spawn?: (command: string, args: string[], options: SpawnOptions) => AsrWorkerProcess;
};

type PendingRequest = {
  resolve: (cues: ReturnType<typeof normalizeTranscript>) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

function pipelineError(code: string, message: string, retryable: boolean, cause?: unknown): PipelineError {
  return new PipelineError('transcript', code, message, retryable, cause);
}

function asProcess(value: ReturnType<typeof spawn>): AsrWorkerProcess {
  return value as unknown as AsrWorkerProcess;
}

export function createAsrWorkerClient(config: AsrWorkerClientConfig, dependencies: AsrWorkerClientDependencies = {}) {
  let child: AsrWorkerProcess | null = null;
  let stdoutBuffer = '';
  let requestSequence = 0;
  const pending = new Map<string, PendingRequest>();

  const rejectAll = (error: PipelineError) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(error);
    }
  };

  const handleResponseLine = (line: string) => {
    let id: string | null = null;
    try {
      const value = JSON.parse(line) as { id?: unknown };
      id = typeof value.id === 'string' ? value.id : null;
    } catch (error: unknown) {
      rejectAll(pipelineError('ASR_PROTOCOL_INVALID', 'ASR worker returned malformed JSON', false, error));
      return;
    }
    if (!id) {
      rejectAll(pipelineError('ASR_PROTOCOL_INVALID', 'ASR worker response omitted its request id', false));
      return;
    }
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    try {
      const response: AsrWorkerResponse = parseAsrWorkerLine(line, id);
      if (!response.ok) {
        request.reject(pipelineError(response.code, response.message, false));
        return;
      }
      request.resolve(normalizeTranscript(response.cues.map((cue) => ({
        start: cue.start,
        end: cue.end,
        text: cue.text,
        source: 'asr' as const,
        ...(cue.confidence === undefined ? {} : { confidence: cue.confidence }),
      }))));
    } catch (error: unknown) {
      request.reject(error);
    }
  };

  const ensureChild = (): AsrWorkerProcess => {
    if (child) return child;
    const spawnImpl = dependencies.spawn ?? ((command, args, options) => asProcess(spawn(command, args, options)));
    child = spawnImpl(config.python, [config.workerPath], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleResponseLine(line);
      }
    });
    child.stderr.on('data', () => undefined);
    child.on('error', (error) => {
      child = null;
      rejectAll(pipelineError('ASR_WORKER_START_FAILED', 'ASR worker could not be started', true, error));
    });
    child.on('exit', () => {
      child = null;
      rejectAll(pipelineError('ASR_WORKER_EXITED', 'ASR worker exited unexpectedly', true));
    });
    child.on('close', () => {
      child = null;
    });
    return child;
  };

  return {
    transcribe(input: { audioPath: string; language?: string }): Promise<ReturnType<typeof normalizeTranscript>> {
      const worker = ensureChild();
      const id = `asr-${++requestSequence}`;
      const request: AsrWorkerRequest = {
        id,
        op: 'transcribe',
        audio_path: input.audioPath,
        language: input.language ?? config.language,
        model: config.model,
        aligner: config.aligner,
        device: config.device,
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(pipelineError('ASR_TIMEOUT', 'ASR transcription timed out', true));
        }, config.timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          worker.stdin.write(`${JSON.stringify(request)}\n`);
        } catch (error: unknown) {
          clearTimeout(timer);
          pending.delete(id);
          reject(pipelineError('ASR_WORKER_WRITE_FAILED', 'ASR worker request could not be sent', true, error));
        }
      });
    },
    close(): void {
      const current = child;
      child = null;
      rejectAll(pipelineError('ASR_WORKER_CLOSED', 'ASR worker was closed', false));
      stdoutBuffer = '';
      if (!current) return;
      try {
        current.stdin.end();
      } finally {
        current.kill();
      }
    },
  };
}
