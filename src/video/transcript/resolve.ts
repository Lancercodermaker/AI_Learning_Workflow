import { PipelineError } from '../../domain/errors';
import type { TranscriptCue } from '../../domain/ir';
import type { BilibiliMaterial } from '../bilibili/client';

export type TranscriptResolverConfig = {
  enabled: boolean;
  language: string;
};

export type TranscriptResolverDependencies = {
  audio: { resolve(bvid: string, materialId: string): Promise<{ path: string }> };
  asr: { transcribe(input: { audioPath: string; language?: string }): Promise<TranscriptCue[]> };
};

function noTranscript(): PipelineError {
  return new PipelineError('transcript', 'NO_TRANSCRIPT', 'Timestamped transcript is required before AI analysis', false);
}

function asrUnavailable(cause: unknown): PipelineError {
  const retryable = cause instanceof PipelineError ? cause.retryable : true;
  return new PipelineError('transcript', 'ASR_UNAVAILABLE', 'Local ASR could not produce a timestamped transcript', retryable, cause);
}

export function createTranscriptResolver(config: TranscriptResolverConfig, dependencies: TranscriptResolverDependencies) {
  return async (input: { source: BilibiliMaterial; materialId: string }): Promise<TranscriptCue[]> => {
    const subtitleTrack = input.source.subtitleTracks.find((track) => track.cues.length > 0);
    if (subtitleTrack) return subtitleTrack.cues;
    if (!config.enabled) throw noTranscript();

    try {
      const audio = await dependencies.audio.resolve(input.source.metadata.bvid, input.materialId);
      const cues = await dependencies.asr.transcribe({ audioPath: audio.path, language: config.language });
      if (cues.length === 0) throw new PipelineError('transcript', 'ASR_EMPTY', 'Local ASR returned no timestamped cues', true);
      return cues;
    } catch (error: unknown) {
      throw asrUnavailable(error);
    }
  };
}
