import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../../src/video/transcript/normalize';

describe('normalizeTranscript', () => {
  it('sorts valid cues, discards only invalid zero-length cues, and assigns stable IDs', () => {
    const normalized = normalizeTranscript([
      { start: 4, end: 7, text: '  source text with spaces  ', source: 'platform' },
      { start: 9, end: 9, text: 'discard me', source: 'platform' },
      { start: 0, end: 2, text: 'first cue', source: 'official' },
      { start: 12, end: 10, text: 'discard me too', source: 'asr' },
    ]);

    expect(normalized).toEqual([
      { id: 't0001', start: 0, end: 2, text: 'first cue', source: 'official' },
      { id: 't0002', start: 4, end: 7, text: '  source text with spaces  ', source: 'platform' },
    ]);
  });

  it('rejects overlap within one source while allowing different sources to overlap', () => {
    expect(() => normalizeTranscript([
      { start: 0, end: 4, text: 'one', source: 'official' },
      { start: 3, end: 5, text: 'two', source: 'official' },
    ])).toThrow('overlapping transcript cues');

    expect(normalizeTranscript([
      { start: 0, end: 4, text: 'official', source: 'official' },
      { start: 3, end: 5, text: 'asr', source: 'asr' },
    ])).toHaveLength(2);
  });
});
