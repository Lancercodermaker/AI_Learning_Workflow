import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '../../src/domain/errors';
import { createAsrWorkerClient, type AsrWorkerProcess } from '../../src/video/asr/worker-client';

class FakeProcess extends EventEmitter implements AsrWorkerProcess {
  readonly writes: string[] = [];
  readonly stdin = {
    write: (value: string) => {
      this.writes.push(value);
      return true;
    },
    end: vi.fn(),
  };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn();
}

function createConfig() {
  return {
    python: 'python.exe',
    workerPath: 'scripts/asr/qwen_worker.py',
    model: 'Qwen/Qwen3-ASR-0.6B',
    aligner: 'Qwen/Qwen3-ForcedAligner-0.6B',
    language: 'Chinese',
    device: 'auto' as const,
    timeoutMs: 1000,
  };
}

describe('ASR worker client', () => {
  it('does not spawn until transcribe is called and reuses the process', async () => {
    const process = new FakeProcess();
    const spawn = vi.fn(() => process);
    const client = createAsrWorkerClient(createConfig(), { spawn });

    expect(spawn).not.toHaveBeenCalled();
    const first = client.transcribe({ audioPath: 'audio.wav' });
    expect(spawn).toHaveBeenCalledTimes(1);
    process.stdout.emit('data', `${JSON.stringify({
      id: 'asr-1', ok: true, language: 'Chinese', cues: [{ start: 0, end: 1, text: '第一句', source: 'asr' }],
    })}\n`);
    await expect(first).resolves.toEqual([{ id: 't0001', start: 0, end: 1, text: '第一句', source: 'asr' }]);

    const second = client.transcribe({ audioPath: 'audio-2.wav' });
    expect(spawn).toHaveBeenCalledTimes(1);
    process.stdout.emit('data', `${JSON.stringify({
      id: 'asr-2', ok: true, language: 'Chinese', cues: [{ start: 2, end: 3, text: '第二句', source: 'asr' }],
    })}\n`);
    await expect(second).resolves.toEqual([{ id: 't0001', start: 2, end: 3, text: '第二句', source: 'asr' }]);
    expect(process.writes).toHaveLength(2);
  });

  it('converts worker failures into a sanitized PipelineError', async () => {
    const process = new FakeProcess();
    const client = createAsrWorkerClient(createConfig(), { spawn: () => process });
    const pending = client.transcribe({ audioPath: 'private-audio.wav' });
    process.stdout.emit('data', `${JSON.stringify({ id: 'asr-1', ok: false, code: 'ASR_MODEL_LOAD_FAILED', message: 'ASR inference was unavailable' })}\n`);

    await expect(pending).rejects.toSatisfy((error: unknown) => {
      return error instanceof PipelineError && error.code === 'ASR_MODEL_LOAD_FAILED' && !String(error).includes('private-audio.wav');
    });
  });

  it('closes the process and rejects pending work', async () => {
    const process = new FakeProcess();
    const client = createAsrWorkerClient(createConfig(), { spawn: () => process });
    const pending = client.transcribe({ audioPath: 'audio.wav' });
    client.close();

    await expect(pending).rejects.toSatisfy((error: unknown) => error instanceof PipelineError && error.code === 'ASR_WORKER_CLOSED');
    expect(process.stdin.end).toHaveBeenCalled();
    expect(process.kill).toHaveBeenCalled();
  });
});
