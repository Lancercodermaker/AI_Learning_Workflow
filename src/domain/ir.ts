import { z } from 'zod';
import type { PipelineStage } from './errors';

const TimeSchema = z.number().finite().nonnegative();
const TimeRangeSchema = z.object({ start: TimeSchema, end: TimeSchema }).refine((value) => value.end > value.start, {
  message: 'end must be greater than start',
});

export const ChapterSchema = TimeRangeSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1),
});

export const TranscriptCueSchema = TimeRangeSchema.extend({
  id: z.string().min(1),
  text: z.string(),
  source: z.enum(['official', 'platform', 'asr']),
  confidence: z.number().finite().min(0).max(1).optional(),
});

const SignalSchema = z.number().finite().min(0).max(1);

export const EvidenceFrameSchema = z.object({
  id: z.string().min(1),
  timestamp: TimeSchema,
  path: z.string().min(1),
  segment_ref: z.string().min(1),
  reason: z.string().min(1),
  signals: z.object({
    visual_change: SignalSchema.optional(),
    ocr_change: SignalSchema.optional(),
    semantic_boundary: SignalSchema.optional(),
  }),
});

export const ClaimSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  type: z.enum(['SOURCE_CLAIM', 'AUTHOR_INTERPRETATION', 'AGENT_INFERENCE']),
  transcript_refs: z.array(z.string().min(1)),
  evidence_timestamps: z.array(TimeSchema),
}).refine((value) => value.transcript_refs.length > 0 || value.evidence_timestamps.length > 0, {
  message: 'claim requires transcript_refs or evidence_timestamps',
});

export const KnowledgeSegmentSchema = TimeRangeSchema.extend({
  id: z.string().min(1),
  topic: z.string().min(1),
  transcript_refs: z.array(z.string().min(1)),
  evidence_frame_refs: z.array(z.string().min(1)),
  claims: z.array(ClaimSchema),
  summary: z.string().optional(),
  importance: z.enum(['low', 'medium', 'high']).optional(),
  recommended_original: TimeRangeSchema.extend({ reason: z.string().min(1) }).optional(),
});

export const PipelineStageSchema = z.enum(['ingest', 'transcript', 'segmentation', 'frames', 'evidence', 'analysis', 'render']);

const PipelineIssueSchema = z.object({
  stage: PipelineStageSchema,
  code: z.string().min(1),
  message: z.string().min(1),
});

export const PipelineStateSchema = z.object({
  status: z.enum(['idle', 'running', 'partial', 'complete', 'failed']),
  current_stage: PipelineStageSchema.optional(),
  completed_stages: z.array(PipelineStageSchema),
  errors: z.array(PipelineIssueSchema),
});

export const MaterialAnalysisSchema = z.object({
  summary: z.string().min(1),
  claims: z.array(ClaimSchema),
  provider: z.string().min(1).optional(),
  generated_at: z.string().datetime().optional(),
});

export const LearningMaterialSchema = z.object({
  schema_version: z.literal('0.2'),
  material: z.object({
    id: z.string().min(1),
    type: z.literal('video'),
    source: z.object({
      platform: z.literal('bilibili'),
      bvid: z.string().regex(/^BV[0-9A-Za-z]+$/),
      url: z.string().url(),
    }),
    metadata: z.object({
      title: z.string().min(1),
      uploader: z.string().optional(),
      duration_seconds: TimeSchema.optional(),
      description: z.string().optional(),
      chapters: z.array(ChapterSchema).optional(),
    }),
  }),
  pipeline: PipelineStateSchema,
  transcript: z.array(TranscriptCueSchema),
  segments: z.array(KnowledgeSegmentSchema),
  evidence_frames: z.array(EvidenceFrameSchema),
  analysis: MaterialAnalysisSchema.optional(),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type TranscriptCue = z.infer<typeof TranscriptCueSchema>;
export type EvidenceFrame = z.infer<typeof EvidenceFrameSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type KnowledgeSegment = z.infer<typeof KnowledgeSegmentSchema>;
export type PipelineState = z.infer<typeof PipelineStateSchema> & { current_stage?: PipelineStage };
export type MaterialAnalysis = z.infer<typeof MaterialAnalysisSchema>;
export type LearningMaterialIR = z.infer<typeof LearningMaterialSchema>;

export function validateMaterialReferences(material: LearningMaterialIR): LearningMaterialIR {
  const transcriptIds = new Set(material.transcript.map((cue) => cue.id));
  const frameIds = new Set(material.evidence_frames.map((frame) => frame.id));
  const segmentIds = new Set(material.segments.map((segment) => segment.id));

  for (const segment of material.segments) {
    for (const transcriptRef of segment.transcript_refs) {
      if (!transcriptIds.has(transcriptRef)) throw new Error(`missing transcript reference: ${transcriptRef}`);
    }
    for (const frameRef of segment.evidence_frame_refs) {
      if (!frameIds.has(frameRef)) throw new Error(`missing evidence frame reference: ${frameRef}`);
    }
    for (const claim of segment.claims) {
      for (const transcriptRef of claim.transcript_refs) {
        if (!transcriptIds.has(transcriptRef)) throw new Error(`missing transcript reference: ${transcriptRef}`);
      }
    }
  }

  for (const frame of material.evidence_frames) {
    if (!segmentIds.has(frame.segment_ref)) throw new Error(`missing segment reference: ${frame.segment_ref}`);
  }
  for (const claim of material.analysis?.claims ?? []) {
    for (const transcriptRef of claim.transcript_refs) {
      if (!transcriptIds.has(transcriptRef)) throw new Error(`missing transcript reference: ${transcriptRef}`);
    }
  }
  return material;
}
