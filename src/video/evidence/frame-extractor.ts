import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { PipelineError } from '../../domain/errors';

export type FrameRange = { segmentId: string; start: number; end: number };

export type ExtractedFrame = {
  id: string;
  timestamp: number;
  path: string;
  segment_ref: string;
  reason: string;
  signals: { semantic_boundary: number };
};

function runFfmpeg(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new PipelineError('frames', 'FFMPEG_UNAVAILABLE', 'ffmpeg-static is unavailable', true));
      return;
    }
    const child = spawn(ffmpegPath, args, { cwd, shell: false, windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
}

function safeSegmentId(segmentId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segmentId)) throw new PipelineError('frames', 'INVALID_SEGMENT_ID', 'segment ID is not safe for a frame filename', false);
  return segmentId;
}

export async function extractFrames(videoPath: string, ranges: FrameRange[], outputDir: string): Promise<ExtractedFrame[]> {
  if (!ffmpegPath) throw new PipelineError('frames', 'FFMPEG_UNAVAILABLE', 'ffmpeg-static is unavailable', true);
  await mkdir(outputDir, { recursive: true });
  const frames: ExtractedFrame[] = [];

  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) {
      throw new PipelineError('frames', 'INVALID_RANGE', 'frame range is invalid', false);
    }
    const segmentId = safeSegmentId(range.segmentId);
    const duration = Math.min(150, range.end - range.start);
    const frameCount = Math.min(30, Math.max(1, Math.ceil(duration / 5)));
    const pattern = join(outputDir, `${segmentId}-F-%03d.jpg`);
    const code = await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-ss', String(range.start), '-t', String(duration),
      '-i', videoPath, '-vf', 'fps=1/5,scale=640:-2', '-frames:v', String(frameCount),
      '-q:v', '3', '-y', pattern,
    ], outputDir);
    if (code !== 0) throw new PipelineError('frames', 'FFMPEG_FAILED', 'ffmpeg could not extract the requested frames', true);

    const files = (await readdir(outputDir)).filter((file) => file.startsWith(`${segmentId}-F-`) && file.endsWith('.jpg')).sort();
    if (files.length === 0) throw new PipelineError('frames', 'NO_FRAMES', 'ffmpeg returned no frame files', true);
    for (const [index, file] of files.entries()) {
      frames.push({
        id: `${segmentId}-F${String(index + 1).padStart(3, '0')}`,
        timestamp: Math.min(range.end, range.start + index * 5),
        path: join(outputDir, file),
        segment_ref: segmentId,
        reason: 'bounded segment sample',
        signals: { semantic_boundary: 0 },
      });
    }
  }
  return frames;
}
