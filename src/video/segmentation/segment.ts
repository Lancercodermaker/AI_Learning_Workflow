import type { Chapter, KnowledgeSegment, TranscriptCue } from '../../domain/ir';

export type SegmentTranscriptInput = {
  transcript: TranscriptCue[];
  chapters: Chapter[];
  visualBoundaries: number[];
};

const semanticPhrase = /^(接下来|第二个|另外|这里要注意|举个例子|总结|最后)/i;
const englishSemanticPhrase = /^(next|second|another|note that|for example|summary|finally)\b/i;

function topicFromText(text: string): string {
  const topic = text
    .replace(/^(接下来|第二个|另外|这里要注意|举个例子|总结|最后)\s*(讲|说|是)?\s*/i, '')
    .replace(/^(next|second|another|note that|for example|summary|finally)\s*/i, '')
    .trim();
  return topic.slice(0, 120) || 'Untitled learning segment';
}

function boundaryIndexAtOrAfter(cues: TranscriptCue[], timestamp: number): number | null {
  const index = cues.findIndex((cue, cueIndex) => cueIndex > 0 && cue.start >= timestamp - 0.01);
  return index < 0 ? null : index;
}

function segmentFromCues(id: string, cues: TranscriptCue[]): KnowledgeSegment {
  const first = cues[0]!;
  const last = cues[cues.length - 1]!;
  return {
    id,
    start: first.start,
    end: last.end,
    topic: topicFromText(first.text),
    transcript_refs: cues.map((cue) => cue.id),
    evidence_frame_refs: [],
    claims: [],
  };
}

export function segmentTranscript(input: SegmentTranscriptInput): KnowledgeSegment[] {
  const transcript = [...input.transcript].sort((left, right) => left.start - right.start);
  if (transcript.length === 0) return [];

  const boundaryIndexes = new Set<number>([0]);
  for (const cue of transcript.slice(1)) {
    if (semanticPhrase.test(cue.text.trim()) || englishSemanticPhrase.test(cue.text.trim())) {
      const index = transcript.findIndex((candidate) => candidate.id === cue.id);
      if (index > 0) boundaryIndexes.add(index);
    }
  }

  for (const chapter of input.chapters) {
    const index = boundaryIndexAtOrAfter(transcript, chapter.start);
    if (index !== null) boundaryIndexes.add(index);
    const endIndex = boundaryIndexAtOrAfter(transcript, chapter.end);
    if (endIndex !== null) boundaryIndexes.add(endIndex);
  }

  for (const timestamp of input.visualBoundaries) {
    const index = boundaryIndexAtOrAfter(transcript, timestamp);
    if (index === null) continue;
    const previous = transcript[index - 1];
    const current = transcript[index];
    // A visual change at a cue transition is still supporting evidence only.
    // Accept it as a segment boundary when a real transcript gap separates topics.
    if (previous && current && current.start - previous.end >= 2.5) boundaryIndexes.add(index);
  }

  const sortedIndexes = [...boundaryIndexes].sort((left, right) => left - right);
  const segments: KnowledgeSegment[] = [];
  for (let index = 0; index < sortedIndexes.length; index += 1) {
    const startIndex = sortedIndexes[index]!;
    const endIndex = sortedIndexes[index + 1] ?? transcript.length;
    const cues = transcript.slice(startIndex, endIndex);
    if (cues.length > 0) segments.push(segmentFromCues(`V${String(segments.length + 1).padStart(2, '0')}`, cues));
  }
  return segments;
}
