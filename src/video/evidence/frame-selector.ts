import type { EvidenceFrame } from '../../domain/ir';

export type FrameCandidate = Pick<EvidenceFrame, 'id' | 'timestamp' | 'path' | 'segment_ref' | 'signals'> & {
  fingerprint?: string;
};

type SelectionOptions = {
  maxFramesPerSegment?: number;
  minDistanceSeconds?: number;
};

function candidateScore(candidate: FrameCandidate): number {
  return 0.25 * (candidate.signals.visual_change ?? 0)
    + 0.35 * (candidate.signals.ocr_change ?? 0)
    + 0.40 * (candidate.signals.semantic_boundary ?? 0);
}

function isDuplicate(candidate: FrameCandidate, selected: FrameCandidate[], minDistanceSeconds: number): boolean {
  return selected.some((other) => (
    (candidate.fingerprint !== undefined && candidate.fingerprint === other.fingerprint)
    || Math.abs(candidate.timestamp - other.timestamp) < minDistanceSeconds
  ));
}

export function selectRepresentativeFrames(
  candidates: FrameCandidate[],
  options: SelectionOptions = {},
): FrameCandidate[] {
  const maxFramesPerSegment = options.maxFramesPerSegment ?? 1;
  const minDistanceSeconds = options.minDistanceSeconds ?? 15;
  if (maxFramesPerSegment < 1) return [];

  const grouped = new Map<string, FrameCandidate[]>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.segment_ref) ?? [];
    group.push(candidate);
    grouped.set(candidate.segment_ref, group);
  }

  const selected: FrameCandidate[] = [];
  for (const group of grouped.values()) {
    const ranked = [...group].sort((left, right) => candidateScore(right) - candidateScore(left) || left.timestamp - right.timestamp);
    const selectedForSegment: FrameCandidate[] = [];
    for (const candidate of ranked) {
      if (selectedForSegment.length >= maxFramesPerSegment) break;
      if (isDuplicate(candidate, selectedForSegment, minDistanceSeconds)) continue;
      selectedForSegment.push(candidate);
    }
    selected.push(...selectedForSegment.sort((left, right) => left.timestamp - right.timestamp));
  }
  return selected;
}
