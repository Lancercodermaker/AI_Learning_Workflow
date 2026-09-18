import { PipelineError, type PipelineStage } from '../domain/errors';
import {
  LearningMaterialSchema,
  validateMaterialReferences,
  type EvidenceFrame,
  type KnowledgeSegment,
  type LearningMaterialIR,
  type MaterialAnalysis,
  type TranscriptCue,
} from '../domain/ir';
import type { BilibiliMaterial } from '../video/bilibili/client';

const RUNNABLE_STAGES: PipelineStage[] = ['ingest', 'transcript', 'segmentation', 'evidence', 'analysis'];

export type PipelineDependencies = {
  store: {
    readStage(materialId: string, stage: string): Promise<unknown | null>;
    writeStage(materialId: string, stage: string, value: unknown): Promise<void>;
    appendLog(materialId: string, entry: { stage: PipelineStage; status: 'start' | 'pass' | 'fail'; message: string; at: string }): Promise<void>;
    writeLearningMaterial(material: LearningMaterialIR): Promise<void>;
  };
  ingest: (bvid: string) => Promise<BilibiliMaterial>;
  transcript: (input: BilibiliMaterial) => Promise<TranscriptCue[]>;
  segmentation: (input: { transcript: TranscriptCue[]; chapters: NonNullable<BilibiliMaterial['metadata']['chapters']>; visualBoundaries: number[] }) => Promise<KnowledgeSegment[]>;
  evidence: (input: { segments: KnowledgeSegment[]; source: BilibiliMaterial }) => Promise<EvidenceFrame[]>;
  analysis: (input: { transcript: TranscriptCue[]; segments: KnowledgeSegment[]; evidenceFrames: EvidenceFrame[] }) => Promise<MaterialAnalysis>;
};

export type PipelineResult = {
  status: 'complete' | 'partial' | 'failed';
  current_stage: PipelineStage;
  material: LearningMaterialIR;
  error?: { code: string; message: string; stage: PipelineStage };
};

type CacheState = {
  ingest: BilibiliMaterial | null;
  transcript: TranscriptCue[] | null;
  segmentation: KnowledgeSegment[] | null;
  evidence: EvidenceFrame[] | null;
  analysis: MaterialAnalysis | null;
};

function materialIdFor(bvid: string): string {
  return `bilibili:${bvid}`;
}

function publicError(stage: PipelineStage, error: unknown): { code: string; message: string; stage: PipelineStage } {
  if (error instanceof PipelineError) {
    return { code: error.code, message: `Pipeline stage ${stage} failed`, stage };
  }
  return { code: 'STAGE_FAILED', message: `Pipeline stage ${stage} failed`, stage };
}

function initialCache(): CacheState {
  return { ingest: null, transcript: null, segmentation: null, evidence: null, analysis: null };
}

function buildMaterial(
  bvid: string,
  cache: CacheState,
  pipeline: LearningMaterialIR['pipeline'],
): LearningMaterialIR {
  const source = cache.ingest;
  const metadata = source?.metadata;
  const material: LearningMaterialIR = {
    schema_version: '0.2',
    material: {
      id: materialIdFor(bvid),
      type: 'video',
      source: { platform: 'bilibili', bvid, url: `https://www.bilibili.com/video/${bvid}` },
      metadata: {
        title: metadata?.title ?? 'Learning material pending ingestion',
        ...(metadata?.uploader === undefined ? {} : { uploader: metadata.uploader }),
        ...(metadata?.duration_seconds === undefined ? {} : { duration_seconds: metadata.duration_seconds }),
        ...(metadata?.description === undefined ? {} : { description: metadata.description }),
        ...(metadata?.chapters === undefined ? {} : { chapters: metadata.chapters }),
      },
    },
    pipeline,
    transcript: cache.transcript ?? [],
    segments: cache.segmentation ?? [],
    evidence_frames: cache.evidence ?? [],
    ...(cache.analysis === null ? {} : { analysis: cache.analysis }),
  };
  return validateMaterialReferences(LearningMaterialSchema.parse(material));
}

export async function runPipeline(input: {
  bvid: string;
  forceStages?: PipelineStage[];
  dependencies: PipelineDependencies;
}): Promise<PipelineResult> {
  const { dependencies } = input;
  const materialId = materialIdFor(input.bvid);
  const cache = initialCache();
  const forcedIndex = Math.min(...(input.forceStages ?? []).map((stage) => RUNNABLE_STAGES.indexOf(stage)).filter((index) => index >= 0), Infinity);
  let currentStage: PipelineStage = 'ingest';

  const ensureStage = async <T extends keyof CacheState>(stage: T, run: () => Promise<NonNullable<CacheState[T]>>): Promise<NonNullable<CacheState[T]>> => {
    const stageIndex = RUNNABLE_STAGES.indexOf(stage as PipelineStage);
    const cached = await dependencies.store.readStage(materialId, stage) as NonNullable<CacheState[T]> | null;
    const mustRun = cached === null || stageIndex >= forcedIndex;
    if (!mustRun) {
      cache[stage] = cached;
      return cached;
    }
    currentStage = stage as PipelineStage;
    await dependencies.store.appendLog(materialId, { stage: currentStage, status: 'start', message: 'stage started', at: new Date().toISOString() });
    const value = await run();
    await dependencies.store.writeStage(materialId, stage, value);
    await dependencies.store.appendLog(materialId, { stage: currentStage, status: 'pass', message: 'stage completed', at: new Date().toISOString() });
    cache[stage] = value;
    return value;
  };

  try {
    const ingest = await ensureStage('ingest', () => dependencies.ingest(input.bvid));
    const transcript = await ensureStage('transcript', () => dependencies.transcript(ingest));
    const segmentation = await ensureStage('segmentation', () => dependencies.segmentation({ transcript, chapters: ingest.metadata.chapters, visualBoundaries: [] }));
    const evidence = await ensureStage('evidence', () => dependencies.evidence({ segments: segmentation, source: ingest }));
    await ensureStage('analysis', () => dependencies.analysis({ transcript, segments: segmentation, evidenceFrames: evidence }));
    currentStage = 'render';
    const material = buildMaterial(input.bvid, cache, {
      status: 'complete',
      current_stage: 'render',
      completed_stages: ['ingest', 'transcript', 'segmentation', 'evidence', 'analysis', 'render'],
      errors: [],
    });
    await dependencies.store.writeLearningMaterial(material);
    return { status: 'complete', current_stage: 'render', material };
  } catch (error: unknown) {
    const publicFailure = publicError(currentStage, error);
    await dependencies.store.appendLog(materialId, { stage: currentStage, status: 'fail', message: publicFailure.code, at: new Date().toISOString() });
    const status = cache.evidence && cache.evidence.length > 0 ? 'partial' : 'failed';
    const material = buildMaterial(input.bvid, cache, {
      status,
      current_stage: currentStage,
      completed_stages: RUNNABLE_STAGES.filter((stage) => cache[stage as keyof CacheState] !== null),
      errors: [{ stage: currentStage, code: publicFailure.code, message: publicFailure.message }],
    });
    await dependencies.store.writeLearningMaterial(material);
    return { status, current_stage: currentStage, material, error: publicFailure };
  }
}
