import { PipelineError, type PipelineStage } from '../../domain/errors';
import type { Chapter, TranscriptCue } from '../../domain/ir';
import { normalizeTranscript, type RawTranscriptCue } from '../transcript/normalize';

export type RawMetadata = {
  bvid: string;
  title: string;
  uploader?: string;
  duration_seconds?: number;
  description?: string;
  chapters: Chapter[];
  aid: number;
  cid: number;
};

export type SubtitleTrack = {
  source: 'official' | 'platform' | 'asr';
  language: string;
  cues: TranscriptCue[];
};

export type IngestWarning = {
  code: 'SUBTITLE_UNAVAILABLE' | 'SUBTITLE_ENDPOINT_UNAVAILABLE' | 'SUBTITLE_FETCH_FAILED';
  message: string;
};

export type BilibiliMaterial = {
  metadata: RawMetadata;
  subtitleTracks: SubtitleTrack[];
  videoUrl?: string;
  warnings: IngestWarning[];
};

export type BilibiliClient = {
  fetchMaterial(bvid: string): Promise<BilibiliMaterial>;
};

type ApiEnvelope = {
  code?: number;
  message?: string;
  data?: unknown;
};

type ViewData = {
  bvid?: string;
  title?: string;
  owner?: { name?: string };
  duration?: number;
  desc?: string;
  aid?: number;
  cid?: number;
  pages?: Array<{ cid?: number; page?: number; part?: string; duration?: number }>;
};

type SubtitleData = {
  subtitle?: {
    subtitles?: Array<{ id?: number; lan?: string; lan_doc?: string; subtitle_url?: string }>;
  };
};

type SubtitleBody = {
  body?: Array<{ from?: number; to?: number; content?: string }>;
};

const API_ORIGIN = 'https://api.bilibili.com';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://www.bilibili.com/',
};
const REQUEST_TIMEOUT_MS = 15_000;

function validateBvid(bvid: string): string {
  const normalized = bvid.trim();
  if (!/^BV[0-9A-Za-z]+$/.test(normalized)) throw new Error('BVID must match ^BV[0-9A-Za-z]+$');
  return normalized;
}

function toAbsoluteUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`;
  return new URL(value, API_ORIGIN).toString();
}

function throwApiError(stage: PipelineStage, response: Response, envelope?: ApiEnvelope): never {
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  const code = envelope?.code === undefined ? `HTTP_${response.status}` : `BILIBILI_${envelope.code}`;
  throw new PipelineError(stage, code, `Bilibili request failed (${response.status})`, retryable);
}

async function readApiJson(fetchImpl: typeof fetch, url: string): Promise<ApiEnvelope> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new PipelineError('ingest', 'NETWORK_ERROR', 'Bilibili request could not be completed', true, error);
  }

  let envelope: ApiEnvelope | undefined;
  try {
    envelope = await response.json() as ApiEnvelope;
  } catch (error: unknown) {
    throw new PipelineError('ingest', 'INVALID_JSON', 'Bilibili returned invalid JSON', response.status >= 500, error);
  }
  if (!response.ok || envelope.code !== 0) throwApiError('ingest', response, envelope);
  return envelope;
}

function normalizeMetadata(data: ViewData): RawMetadata {
  if (!data.bvid || !data.title || !data.aid || !data.cid) {
    throw new PipelineError('ingest', 'METADATA_INVALID', 'Bilibili metadata omitted required fields', false);
  }
  const chapters: Chapter[] = [];
  let cursor = 0;
  for (const [index, page] of (data.pages ?? []).entries()) {
    const duration = page.duration ?? 0;
    if (!page.cid || !page.part || duration <= 0) continue;
    chapters.push({ id: `c${String(index + 1).padStart(2, '0')}`, start: cursor, end: cursor + duration, title: page.part });
    cursor += duration;
  }
  return {
    bvid: data.bvid,
    title: data.title,
    ...(data.owner?.name ? { uploader: data.owner.name } : {}),
    ...(data.duration === undefined ? {} : { duration_seconds: data.duration }),
    ...(data.desc === undefined ? {} : { description: data.desc }),
    chapters,
    aid: data.aid,
    cid: data.cid,
  };
}

async function readSubtitleTrack(fetchImpl: typeof fetch, raw: { lan?: string; lan_doc?: string; subtitle_url?: string }): Promise<SubtitleTrack | null> {
  if (!raw.subtitle_url) return null;
  const envelope = await readApiJson(fetchImpl, toAbsoluteUrl(raw.subtitle_url));
  const body = (envelope.data as SubtitleBody | undefined)?.body ?? [];
  const cues: RawTranscriptCue[] = body.flatMap((cue) => (
    cue.from !== undefined && cue.to !== undefined && cue.content !== undefined
      ? [{ start: cue.from, end: cue.to, text: cue.content, source: 'platform' as const }]
      : []
  ));
  if (cues.length === 0) return null;
  return { source: 'platform', language: raw.lan_doc ?? raw.lan ?? 'unknown', cues: normalizeTranscript(cues) };
}

function selectPreferredTracks(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const priority: Record<SubtitleTrack['source'], number> = { official: 0, platform: 1, asr: 2 };
  return [...tracks].sort((left, right) => priority[left.source] - priority[right.source]);
}

export function createBilibiliClient(fetchImpl: typeof fetch = fetch): BilibiliClient {
  return {
    async fetchMaterial(rawBvid: string): Promise<BilibiliMaterial> {
      const bvid = validateBvid(rawBvid);
      const viewUrl = `${API_ORIGIN}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
      const viewEnvelope = await readApiJson(fetchImpl, viewUrl);
      const metadata = normalizeMetadata(viewEnvelope.data as ViewData);
      const warnings: IngestWarning[] = [];
      const subtitleTracks: SubtitleTrack[] = [];

      const playerUrl = `${API_ORIGIN}/x/player/v2?aid=${metadata.aid}&cid=${metadata.cid}`;
      try {
        const playerEnvelope = await readApiJson(fetchImpl, playerUrl);
        const rawTracks = ((playerEnvelope.data as SubtitleData | undefined)?.subtitle?.subtitles ?? []);
        for (const rawTrack of rawTracks) {
          try {
            const track = await readSubtitleTrack(fetchImpl, rawTrack);
            if (track) subtitleTracks.push(track);
          } catch {
            warnings.push({ code: 'SUBTITLE_FETCH_FAILED', message: 'A public subtitle track could not be downloaded.' });
          }
        }
      } catch {
        warnings.push({ code: 'SUBTITLE_ENDPOINT_UNAVAILABLE', message: 'The public subtitle endpoint was unavailable.' });
      }
      if (subtitleTracks.length === 0) {
        warnings.push({ code: 'SUBTITLE_UNAVAILABLE', message: 'No public timestamped subtitle track was available.' });
      }
      return { metadata, subtitleTracks: selectPreferredTracks(subtitleTracks), warnings };
    },
  };
}
