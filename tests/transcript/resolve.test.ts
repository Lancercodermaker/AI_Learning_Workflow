import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '../../src/domain/errors';
import type { BilibiliMaterial } from '../../src/video/bilibili/client';
import { createTranscriptResolver } from '../../src/video/transcript/resolve';

const material = (subtitleCues: BilibiliMaterial['subtitleTracks'][number]['cues'] = []): BilibiliMaterial => ({
  metadata: { bvid: 'BV1fixture', title: 'Fixture', chapters: [], aid: 1, cid: 2 },
  subtitleTracks: subtitleCues.length ? [{ source: 'platform', language: 'Chinese', cues: subtitleCues }] : [],
  warnings: [],
});

const asrCue = { id: 't0001', start: 0, end: 2, text: 'ASR 句子', source: 'asr' as const };

describe('subtitle-first transcript resolver', () => {
  it('uses public subtitles without invoking audio or ASR', async () => {
    const audio = { resolve: vi.fn() };
    const asr = { transcribe: vi.fn() };
    const resolve = createTranscriptResolver({ enabled: true, language: 'Chinese' }, { audio, asr });
    const subtitle = [{ id: 't0001', start: 0, end: 1, text: '公开字幕', source: 'platform' as const }];

    await expect(resolve({ source: material(subtitle), materialId: 'bilibili:BV1fixture' })).resolves.toEqual(subtitle);
    expect(audio.resolve).not.toHaveBeenCalled();
    expect(asr.transcribe).not.toHaveBeenCalled();
  });

  it('uses local ASR only after public subtitles are unavailable', async () => {
    const audio = { resolve: vi.fn(async () => ({ path: 'data/materials/bilibili-BV1fixture/audio/source.wav' })) };
    const asr = { transcribe: vi.fn(async () => [asrCue]) };
    const resolve = createTranscriptResolver({ enabled: true, language: 'Chinese' }, { audio, asr });

    await expect(resolve({ source: material(), materialId: 'bilibili:BV1fixture' })).resolves.toEqual([asrCue]);
    expect(audio.resolve).toHaveBeenCalledWith('BV1fixture', 'bilibili:BV1fixture');
    expect(asr.transcribe).toHaveBeenCalledWith({ audioPath: 'data/materials/bilibili-BV1fixture/audio/source.wav', language: 'Chinese' });
  });

  it('preserves NO_TRANSCRIPT when ASR is disabled', async () => {
    const resolve = createTranscriptResolver({ enabled: false, language: 'Chinese' }, {
      audio: { resolve: vi.fn() },
      asr: { transcribe: vi.fn() },
    });

    await expect(resolve({ source: material(), materialId: 'bilibili:BV1fixture' })).rejects.toSatisfy((error: unknown) => error instanceof PipelineError && error.code === 'NO_TRANSCRIPT');
  });

  it('converts enabled fallback failures to ASR_UNAVAILABLE', async () => {
    const resolve = createTranscriptResolver({ enabled: true, language: 'Chinese' }, {
      audio: { resolve: vi.fn(async () => { throw new PipelineError('transcript', 'AUDIO_UNAVAILABLE', 'audio unavailable', true); }) },
      asr: { transcribe: vi.fn() },
    });

    await expect(resolve({ source: material(), materialId: 'bilibili:BV1fixture' })).rejects.toSatisfy((error: unknown) => error instanceof PipelineError && error.code === 'ASR_UNAVAILABLE' && !String(error).includes('source.wav'));
  });
});
