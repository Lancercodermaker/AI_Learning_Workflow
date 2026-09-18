import type { SegmentAnalysisInput } from './gateway';

export const GROUNDED_ANALYSIS_SYSTEM_PROMPT = [
  'You analyze one learning segment from source evidence.',
  'Return JSON only with the shape {summary, claims}.',
  'Every claim must have claim, type, transcript_refs, and evidence_timestamps.',
  'Use SOURCE_CLAIM only for what the transcript or frame directly supports.',
  'Use AUTHOR_INTERPRETATION for an interpretation explicitly attributable to the source author.',
  'Use AGENT_INFERENCE only for a clearly labeled inference supported by the supplied evidence.',
  'Never invent transcript IDs, timestamps, or facts. If evidence is insufficient, say so in the summary and do not fill gaps.',
].join(' ');

export function buildAnalysisUserPrompt(input: SegmentAnalysisInput): string {
  return JSON.stringify({
    task: 'Analyze the segment while preserving provenance.',
    segment_id: input.segmentId,
    transcript: input.transcript,
    allowed_evidence_timestamps: input.evidenceTimestamps,
  });
}

export function buildRepairPrompt(input: SegmentAnalysisInput, invalidOutput: string): string {
  return [
    'Repair the following output into JSON only using the same source context.',
    'Do not add unsupported claims, IDs, or timestamps.',
    `Source context: ${buildAnalysisUserPrompt(input)}`,
    `Invalid output: ${invalidOutput.slice(0, 12_000)}`,
  ].join('\n');
}
