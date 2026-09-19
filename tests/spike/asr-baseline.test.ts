import { describe, expect, it } from 'vitest';
import { buildAsrSpikeRecord, parseAudioArgument } from '../../scripts/spike/asr-baseline';

describe('ASR baseline spike helpers', () => {
  it('requires an explicit local audio path', () => {
    expect(parseAudioArgument(['node', 'spike'])).toBeNull();
    expect(parseAudioArgument(['node', 'spike', '--audio', 'sample.wav'])).toBe('sample.wav');
  });

  it('keeps the experiment record sanitized', () => {
    const record = buildAsrSpikeRecord({
      model: 'Qwen/Qwen3-ASR-0.6B',
      device: 'cuda:0',
      firstElapsedMs: 1234.5,
      secondElapsedMs: 42.25,
      firstCueCount: 8,
      secondCueCount: 8,
      failureStage: null,
    });

    expect(record).toEqual({
      model: 'Qwen/Qwen3-ASR-0.6B',
      device: 'cuda:0',
      first_elapsed_ms: 1235,
      second_elapsed_ms: 42,
      first_cue_count: 8,
      second_cue_count: 8,
      failure_stage: null,
    });
    expect(JSON.stringify(record)).not.toContain('sample.wav');
  });

  it('does not record a local model path', () => {
    const record = buildAsrSpikeRecord({
      model: 'E:\\cache\\Qwen3-ASR-0.6B',
      device: 'cuda:0',
      firstElapsedMs: null,
      secondElapsedMs: null,
      firstCueCount: null,
      secondCueCount: null,
      failureStage: 'first_transcription',
    });

    expect(record.model).toBe('Qwen3-ASR-0.6B');
    expect(JSON.stringify(record)).not.toContain('E:\\cache');
  });
});
