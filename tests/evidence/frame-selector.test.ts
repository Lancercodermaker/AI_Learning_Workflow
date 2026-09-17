import { describe, expect, it } from 'vitest';
import { selectRepresentativeFrames, type FrameCandidate } from '../../src/video/evidence/frame-selector';

const candidate = (overrides: Partial<FrameCandidate>): FrameCandidate => ({
  id: 'candidate',
  timestamp: 0,
  path: 'frames/candidate.jpg',
  segment_ref: 'V01',
  signals: { visual_change: 0.5, ocr_change: 0.5, semantic_boundary: 0.5 },
  ...overrides,
});

describe('selectRepresentativeFrames', () => {
  it('selects one representative frame per existing segment', () => {
    const selected = selectRepresentativeFrames([
      candidate({ id: 'v01', segment_ref: 'V01', timestamp: 2 }),
      candidate({ id: 'v02', segment_ref: 'V02', timestamp: 20 }),
    ]);
    expect(selected.map((frame) => frame.segment_ref)).toEqual(['V01', 'V02']);
  });

  it('enforces temporal distance and suppresses exact near-duplicates', () => {
    const selected = selectRepresentativeFrames([
      candidate({ id: 'best', timestamp: 0, fingerprint: 'same', signals: { visual_change: 0.4, ocr_change: 0.8, semantic_boundary: 1 } }),
      candidate({ id: 'duplicate', timestamp: 5, fingerprint: 'same', signals: { visual_change: 1, ocr_change: 0, semantic_boundary: 0 } }),
      candidate({ id: 'far', timestamp: 20, fingerprint: 'different', signals: { visual_change: 0.4, ocr_change: 0.6, semantic_boundary: 0.8 } }),
    ], { maxFramesPerSegment: 2, minDistanceSeconds: 15 });

    expect(selected.map((frame) => frame.id)).toEqual(['best', 'far']);
  });

  it('prefers a complete formula frame over visually noisy novelty', () => {
    const selected = selectRepresentativeFrames([
      candidate({ id: 'noise', signals: { visual_change: 1, ocr_change: 0.1, semantic_boundary: 0.1 } }),
      candidate({ id: 'formula', timestamp: 20, signals: { visual_change: 0.6, ocr_change: 0.95, semantic_boundary: 1 } }),
    ]);
    expect(selected[0]?.id).toBe('formula');
  });

  it('never creates a segment from visual novelty alone', () => {
    const selected = selectRepresentativeFrames([
      candidate({ id: 'v01-noise', segment_ref: 'V01', signals: { visual_change: 1, ocr_change: 0, semantic_boundary: 0 } }),
      candidate({ id: 'v01-formula', segment_ref: 'V01', timestamp: 20 }),
    ]);
    expect(new Set(selected.map((frame) => frame.segment_ref))).toEqual(new Set(['V01']));
  });
});
