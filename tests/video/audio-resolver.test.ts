import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '../../src/domain/errors';
import { createBilibiliAudioResolver, type AudioResolverProcess } from '../../src/video/media/audio-resolver';

class FakeProcess extends EventEmitter implements AudioResolverProcess {
  readonly kill = vi.fn();
}

describe('Bilibili audio resolver', () => {
  it('rejects invalid BVID before invoking yt-dlp', async () => {
    const spawn = vi.fn();
    const resolver = createBilibiliAudioResolver({
      python: 'python.exe',
      ffmpegPath: 'ffmpeg.exe',
      getMaterialDir: () => 'data/materials/bilibili-invalid',
    }, { spawn });

    await expect(resolver.resolve('not-a-bvid', 'bilibili:not-a-bvid')).rejects.toThrow('BVID');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns a cached audio file without spawning yt-dlp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asr-audio-test-'));
    try {
      const directory = join(root, 'audio');
      const audioPath = join(directory, 'source.wav');
      await mkdir(directory, { recursive: true });
      await writeFile(audioPath, 'cached');
      const spawn = vi.fn();
      const resolver = createBilibiliAudioResolver({
        python: 'python.exe',
        ffmpegPath: 'ffmpeg.exe',
        getMaterialDir: () => root,
      }, { spawn });

      await expect(resolver.resolve('BV1fixture', 'bilibili:BV1fixture')).resolves.toEqual({ path: audioPath });
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('downloads and extracts audio with safe process arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asr-audio-test-'));
    try {
      const process = new FakeProcess();
      const spawn = vi.fn((_command: string, args: string[]) => {
        const outputPath = args[args.indexOf('--output') + 1];
        void writeFile(outputPath, 'audio').then(() => process.emit('close', 0));
        return process;
      });
      const resolver = createBilibiliAudioResolver({
        python: 'C:/conda/python.exe',
        ffmpegPath: 'C:/tools/ffmpeg.exe',
        getMaterialDir: () => root,
      }, { spawn });

      const result = await resolver.resolve('BV1fixture', 'bilibili:BV1fixture');
      expect(result.path).toBe(join(root, 'audio', 'source.wav'));
      expect(spawn).toHaveBeenCalledWith(
        'C:/conda/python.exe',
        expect.arrayContaining([
          '-m', 'yt_dlp', '--proxy', '', '--format', 'ba/b', '--extract-audio', '--audio-format', 'wav',
          '--ffmpeg-location', 'C:/tools/ffmpeg.exe', '--output', result.path,
        ]),
        expect.objectContaining({ shell: false, windowsHide: true }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('converts a failed download into AUDIO_UNAVAILABLE', async () => {
    const process = new FakeProcess();
    const spawn = vi.fn(() => process);
    const resolver = createBilibiliAudioResolver({
      python: 'python.exe',
      ffmpegPath: 'ffmpeg.exe',
      getMaterialDir: () => 'data/materials/bilibili-BV1fixture',
    }, { spawn });

    const pending = resolver.resolve('BV1fixture', 'bilibili:BV1fixture');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    process.emit('close', 1);
    await expect(pending).rejects.toSatisfy((error: unknown) => error instanceof PipelineError && error.code === 'AUDIO_UNAVAILABLE');
  });
});
