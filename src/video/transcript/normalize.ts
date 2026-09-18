import type { TranscriptCue } from '../../domain/ir';

export type RawTranscriptCue = {
  start: number;
  end: number;
  text: string;
  source: TranscriptCue['source'];
  confidence?: number;
};

export function normalizeTranscript(cues: RawTranscriptCue[]): TranscriptCue[] {
  const valid = cues.filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start);
  const sorted = [...valid].sort((left, right) => left.start - right.start || left.end - right.end);
  const lastBySource = new Map<TranscriptCue['source'], TranscriptCue>();

  const normalized: TranscriptCue[] = [];
  for (const [index, cue] of sorted.entries()) {
    const previous = lastBySource.get(cue.source);
    if (previous && cue.start < previous.end) {
      throw new Error('overlapping transcript cues');
    }
    const normalizedCue: TranscriptCue = {
      id: `t${String(index + 1).padStart(4, '0')}`,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      source: cue.source,
      ...(cue.confidence === undefined ? {} : { confidence: cue.confidence }),
    };
    normalized.push(normalizedCue);
    lastBySource.set(cue.source, normalizedCue);
  }
  return normalized;
}
