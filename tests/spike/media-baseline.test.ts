import { describe, expect, it } from 'vitest';
import { buildYtDlpArgs, parseVtt, sanitizeBvid } from '../../scripts/spike/media-baseline';

describe('media baseline helpers', () => {
  it('accepts a BVID and rejects shell-shaped input', () => {
    expect(sanitizeBvid('BV1Q6en6NEUo')).toBe('BV1Q6en6NEUo');
    expect(() => sanitizeBvid('BV1Q6en6NEUo & whoami')).toThrow();
  });

  it('normalizes timestamped VTT cues into bounded transcript material', () => {
    const cues = parseVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:04.500\nHello <i>world</i>.\n\n00:00:06.000 --> 00:00:08.000\nSecond cue`);

    expect(cues).toEqual([
      { start: 1, end: 4.5, text: 'Hello world.' },
      { start: 6, end: 8, text: 'Second cue' },
    ]);
  });

  it('makes source requests independent of the ambient proxy configuration', () => {
    expect(buildYtDlpArgs(['--dump-single-json'])).toEqual([
      '--proxy', '',
      '--add-header', 'User-Agent: Mozilla/5.0',
      '--add-header', 'Referer: https://www.bilibili.com/',
      '--dump-single-json',
    ]);
  });
});
