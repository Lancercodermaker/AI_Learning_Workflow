import { z } from 'zod';
import { PipelineError } from '../domain/errors';
import { createCommandCodeAdapter } from './commandcode-adapter';
import { createDeepSeekAdapter } from './deepseek-adapter';
import { createOpenCodeAdapter } from './opencode-adapter';
import type { ChatMessage, CompletionAdapter, HttpAdapterDependencies } from './http-adapter';
import { buildAnalysisUserPrompt, buildRepairPrompt, GROUNDED_ANALYSIS_SYSTEM_PROMPT } from './analysis-prompts';

export type ProviderName = 'opencode' | 'commandcode' | 'deepseek';
export type ProviderConfig = { provider: ProviderName; baseUrl: string; apiKey: string; model: string; timeoutMs: number };
export type SegmentAnalysisInput = {
  segmentId: string;
  transcript: Array<{ id: string; start: number; end: number; text: string; source: string }>;
  evidenceTimestamps: number[];
};
export type AnalysisResult = {
  summary: string;
  claims: Array<{
    claim: string;
    type: 'SOURCE_CLAIM' | 'AUTHOR_INTERPRETATION' | 'AGENT_INFERENCE';
    transcript_refs: string[];
    evidence_timestamps: number[];
  }>;
};
export type AnalysisGateway = { analyze(input: SegmentAnalysisInput): Promise<AnalysisResult> };

const GeneratedClaimSchema = z.object({
  claim: z.string().min(1),
  type: z.enum(['SOURCE_CLAIM', 'AUTHOR_INTERPRETATION', 'AGENT_INFERENCE']),
  transcript_refs: z.array(z.string().min(1)),
  evidence_timestamps: z.array(z.number().finite().nonnegative()),
}).refine((claim) => claim.transcript_refs.length > 0 || claim.evidence_timestamps.length > 0, {
  message: 'claim must retain transcript or evidence provenance',
});

const AnalysisResponseSchema = z.object({
  summary: z.string().min(1),
  claims: z.array(GeneratedClaimSchema),
});

function adapterFor(config: ProviderConfig, dependencies: HttpAdapterDependencies): CompletionAdapter {
  if (config.provider === 'opencode') return createOpenCodeAdapter(config, dependencies);
  if (config.provider === 'commandcode') return createCommandCodeAdapter(config, dependencies);
  return createDeepSeekAdapter(config, dependencies);
}

function parseGroundedAnalysis(output: string, input: SegmentAnalysisInput): AnalysisResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch (error: unknown) {
    throw new PipelineError('analysis', 'LLM_SCHEMA_INVALID', 'LLM output was not valid JSON', false, error);
  }
  const parsed = AnalysisResponseSchema.safeParse(decoded);
  if (!parsed.success) throw new PipelineError('analysis', 'LLM_SCHEMA_INVALID', 'LLM output did not match the grounded analysis schema', false, parsed.error);
  const transcriptIds = new Set(input.transcript.map((cue) => cue.id));
  const evidenceTimestamps = new Set(input.evidenceTimestamps);
  for (const claim of parsed.data.claims) {
    if (claim.transcript_refs.some((reference) => !transcriptIds.has(reference))) {
      throw new PipelineError('analysis', 'LLM_SCHEMA_INVALID', 'LLM output referenced an unknown transcript cue', false);
    }
    if (claim.evidence_timestamps.some((timestamp) => !evidenceTimestamps.has(timestamp))) {
      throw new PipelineError('analysis', 'LLM_SCHEMA_INVALID', 'LLM output referenced an unknown evidence timestamp', false);
    }
  }
  return parsed.data;
}

export function createGateway(config: ProviderConfig, dependencies: HttpAdapterDependencies = {}): AnalysisGateway {
  const adapter = adapterFor(config, dependencies);
  return {
    async analyze(input: SegmentAnalysisInput): Promise<AnalysisResult> {
      const messages: ChatMessage[] = [
        { role: 'system', content: GROUNDED_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildAnalysisUserPrompt(input) },
      ];
      const firstOutput = await adapter.complete(messages);
      try {
        return parseGroundedAnalysis(firstOutput, input);
      } catch (firstError: unknown) {
        const repairMessages: ChatMessage[] = [
          ...messages,
          { role: 'assistant', content: firstOutput },
          { role: 'user', content: buildRepairPrompt(input, firstOutput) },
        ];
        const repairedOutput = await adapter.complete(repairMessages);
        try {
          return parseGroundedAnalysis(repairedOutput, input);
        } catch (secondError: unknown) {
          throw new PipelineError('analysis', 'LLM_SCHEMA_INVALID', 'LLM output remained invalid after one repair request', false, secondError ?? firstError);
        }
      }
    },
  };
}
