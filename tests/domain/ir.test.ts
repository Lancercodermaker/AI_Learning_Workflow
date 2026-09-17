import { describe, expect, it } from 'vitest';
import { LearningMaterialSchema, validateMaterialReferences } from '../../src/domain/ir';

const validMaterial = {
  schema_version: '0.2',
  material: {
    id: 'material-1',
    type: 'video',
    source: {
      platform: 'bilibili',
      bvid: 'BV1fixture',
      url: 'https://www.bilibili.com/video/BV1fixture',
    },
    metadata: {
      title: 'Probability basics',
      uploader: 'Teacher',
      duration_seconds: 120,
      chapters: [{ id: 'c01', start: 0, end: 120, title: 'Basics' }],
    },
  },
  pipeline: {
    status: 'complete',
    current_stage: 'render',
    completed_stages: ['ingest', 'transcript', 'segmentation', 'frames', 'evidence', 'analysis', 'render'],
    errors: [],
  },
  transcript: [{ id: 't0001', start: 0, end: 8, text: 'A random variable maps outcomes to numbers.', source: 'official' }],
  segments: [{
    id: 'V01',
    start: 0,
    end: 8,
    topic: 'Random variables',
    transcript_refs: ['t0001'],
    evidence_frame_refs: ['f0001'],
    claims: [{
      id: 'claim-1',
      claim: 'A random variable maps outcomes to numbers.',
      type: 'SOURCE_CLAIM',
      transcript_refs: ['t0001'],
      evidence_timestamps: [3],
    }],
  }],
  evidence_frames: [{
    id: 'f0001',
    timestamp: 3,
    path: 'frames/f0001.jpg',
    segment_ref: 'V01',
    reason: 'Representative formula frame',
    signals: { visual_change: 0.2, ocr_change: 0.8, semantic_boundary: 1 },
  }],
  analysis: {
    summary: 'The lesson introduces random variables.',
    claims: [],
  },
};

describe('Learning Material IR', () => {
  it('parses a grounded Bilibili learning material', () => {
    const parsed = LearningMaterialSchema.parse(validMaterial);
    expect(parsed.schema_version).toBe('0.2');
    expect(parsed.segments[0]?.claims[0]?.type).toBe('SOURCE_CLAIM');
    expect(validateMaterialReferences(parsed)).toEqual(parsed);
  });

  it('rejects a claim with no transcript or evidence reference', () => {
    const invalid = structuredClone(validMaterial);
    invalid.segments[0].claims[0].transcript_refs = [];
    invalid.segments[0].claims[0].evidence_timestamps = [];
    expect(() => LearningMaterialSchema.parse(invalid)).toThrow();
  });

  it('rejects segment references that do not resolve', () => {
    const invalid = LearningMaterialSchema.parse(validMaterial);
    invalid.segments[0]!.transcript_refs = ['missing'];
    expect(() => validateMaterialReferences(invalid)).toThrow(/transcript reference/);
  });
});
