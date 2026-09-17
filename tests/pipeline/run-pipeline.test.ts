import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/learning-material.json';
import { LearningMaterialSchema } from '../../src/domain/ir';
import { runPipeline, type PipelineDependencies } from '../../src/pipeline/run-pipeline';
import type { BilibiliMaterial } from '../../src/video/bilibili/client';

const material = LearningMaterialSchema.parse(fixture);

function dependencies(overrides: Partial<PipelineDependencies> = {}) {
  const cached = new Map<string, unknown>([
    ['ingest', { metadata: { ...material.material.metadata, bvid: material.material.source.bvid, aid: 1, cid: 2 }, subtitleTracks: [] }],
    ['transcript', material.transcript],
    ['segmentation', material.segments],
    ['evidence', material.evidence_frames],
  ]);
  const store = {
    readStage: vi.fn(async (_id: string, stage: string) => cached.get(stage) ?? null),
    writeStage: vi.fn(async (_id: string, stage: string, value: unknown) => { cached.set(stage, value); }),
    appendLog: vi.fn(async () => undefined),
    writeLearningMaterial: vi.fn(async () => undefined),
  };
  return {
    store,
    ingest: vi.fn(async () => cached.get('ingest') as BilibiliMaterial),
    transcript: vi.fn(async () => material.transcript),
    segmentation: vi.fn(async () => material.segments),
    evidence: vi.fn(async () => material.evidence_frames),
    analysis: vi.fn(async () => ({ summary: 'analysis result', claims: [] })),
    ...overrides,
  } satisfies PipelineDependencies;
}

describe('runPipeline', () => {
  it('reuses transcript and frames when only analysis is forced', async () => {
    const deps = dependencies();
    const result = await runPipeline({ bvid: 'BV1fixture', forceStages: ['analysis'], dependencies: deps });

    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.transcript).not.toHaveBeenCalled();
    expect(deps.segmentation).not.toHaveBeenCalled();
    expect(deps.evidence).not.toHaveBeenCalled();
    expect(deps.analysis).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
    expect(result.material.evidence_frames).toHaveLength(1);
  });

  it('preserves prior evidence and returns a sanitized partial result on analysis failure', async () => {
    const deps = dependencies({ analysis: vi.fn(async () => { throw new Error('provider secret-test-key leaked'); }) });
    const result = await runPipeline({ bvid: 'BV1fixture', forceStages: ['analysis'], dependencies: deps });

    expect(result.status).toBe('partial');
    expect(result.current_stage).toBe('analysis');
    expect(result.material.evidence_frames).toHaveLength(1);
    expect(result.error?.message).not.toContain('secret-test-key');
    expect(result.error?.code).toBe('STAGE_FAILED');
  });
});
