import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { PipelineError } from '../../domain/errors';

export type AudioResolverProcess = {
  on(event: 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
};

export type AudioResolverConfig = {
  python: string;
  ffmpegPath: string;
  getMaterialDir: (materialId: string) => string;
  timeoutMs?: number;
};

export type AudioResolverDependencies = {
  spawn?: (command: string, args: string[], options: SpawnOptions) => AudioResolverProcess;
};

function validateBvid(bvid: string): string {
  const normalized = bvid.trim();
  if (!/^BV[0-9A-Za-z]+$/.test(normalized)) throw new Error('BVID must match ^BV[0-9A-Za-z]+$');
  return normalized;
}

function unavailable(cause?: unknown): PipelineError {
  return new PipelineError('transcript', 'AUDIO_UNAVAILABLE', 'Local audio could not be prepared for ASR', true, cause);
}

function runYtDlp(
  python: string,
  args: string[],
  timeoutMs: number,
  dependencies: AudioResolverDependencies,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const spawnImpl = dependencies.spawn ?? ((command, childArgs, options) => spawn(command, childArgs, options));
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const child = spawnImpl(python, args, { shell: false, windowsHide: true });
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      work();
    };
    child.on('error', (error) => settle(() => reject(unavailable(error))));
    child.on('close', (code) => settle(() => resolve(typeof code === 'number' ? code : -1)));
    timer = setTimeout(() => {
      try {
        child.kill();
      } finally {
        settle(() => reject(unavailable()));
      }
    }, timeoutMs);
  });
}

export function createBilibiliAudioResolver(config: AudioResolverConfig, dependencies: AudioResolverDependencies = {}) {
  return {
    async resolve(rawBvid: string, materialId: string): Promise<{ path: string }> {
      const bvid = validateBvid(rawBvid);
      if (materialId !== `bilibili:${bvid}`) throw new Error('material ID does not match BVID');
      const materialDirectory = config.getMaterialDir(materialId);
      const audioDirectory = join(materialDirectory, 'audio');
      const audioPath = join(audioDirectory, 'source.wav');
      try {
        await access(audioPath);
        return { path: audioPath };
      } catch {
        // Cache miss; continue with media acquisition.
      }
      await mkdir(audioDirectory, { recursive: true });
      const sourceUrl = `https://www.bilibili.com/video/${bvid}`;
      const args = [
        '-m', 'yt_dlp',
        '--proxy', '',
        '--add-header', 'User-Agent: Mozilla/5.0',
        '--add-header', 'Referer: https://www.bilibili.com/',
        '--no-playlist',
        '--quiet',
        '--format', 'ba/b',
        '--extract-audio',
        '--audio-format', 'wav',
        '--ffmpeg-location', config.ffmpegPath,
        '--output', audioPath,
        sourceUrl,
      ];
      const code = await runYtDlp(config.python, args, config.timeoutMs ?? 900_000, dependencies);
      if (code !== 0) throw unavailable();
      try {
        await access(audioPath);
      } catch (error: unknown) {
        throw unavailable(error);
      }
      return { path: audioPath };
    },
  };
}

export function defaultAudioResolverConfig(getMaterialDir: (materialId: string) => string, python: string): AudioResolverConfig {
  if (!ffmpegPath) throw new PipelineError('transcript', 'FFMPEG_UNAVAILABLE', 'ffmpeg-static is unavailable', true);
  return { python, ffmpegPath, getMaterialDir };
}
