import { describe, expect, it } from 'vitest';
import { segmentTranscript } from '../../src/video/segmentation/segment';

describe('segmentTranscript', () => {
  it('prioritizes chapter and semantic boundaries over a same-topic visual change', () => {
    const segments = segmentTranscript({
      transcript: [
        { id: 't0001', start: 0, end: 4, text: 'Background and motivation.', source: 'official' },
        { id: 't0002', start: 4, end: 8, text: '接下来讲 Cross Entropy', source: 'official' },
        { id: 't0003', start: 8, end: 12, text: 'The IDE changes, but the Cross Entropy topic continues.', source: 'official' },
        { id: 't0004', start: 12, end: 16, text: '最后总结 the key idea.', source: 'official' },
      ],
      chapters: [
        { id: 'c01', start: 0, end: 4, title: 'Background' },
        { id: 'c02', start: 4, end: 16, title: 'Cross Entropy' },
      ],
      visualBoundaries: [8],
    });

    expect(segments.map(({ id, start, end, transcript_refs }) => ({ id, start, end, transcript_refs }))).toEqual([
      { id: 'V01', start: 0, end: 4, transcript_refs: ['t0001'] },
      { id: 'V02', start: 4, end: 12, transcript_refs: ['t0002', 't0003'] },
      { id: 'V03', start: 12, end: 16, transcript_refs: ['t0004'] },
    ]);
  });

  it('keeps a single cue inside its own time range', () => {
    const [segment] = segmentTranscript({
      transcript: [{ id: 't0001', start: 5, end: 9, text: 'One bounded idea.', source: 'asr' }],
      chapters: [],
      visualBoundaries: [7],
    });
    expect(segment).toMatchObject({ id: 'V01', start: 5, end: 9, transcript_refs: ['t0001'] });
  });
});
