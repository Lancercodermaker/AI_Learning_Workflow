# P0 acceptance checklist

Run under test: `BV1DE421M7AZ`

## Browser and product behavior

- [x] BVID input accepted and normalized.
- [x] Material Profile renders title, duration, and source.
- [x] Knowledge Map renders before the long timeline.
- [ ] Selecting a map node narrows related timeline segments. The real run has zero transcript-derived segments; this behavior is covered by the UI component contract but cannot be exercised with this source.
- [x] The UI clearly reports that no major segments or representative frames are available when transcript evidence is unavailable.
- [ ] Important claims show a source type and timestamp. No claims are emitted because no transcript exists.
- [x] The controlled fixture renders a Bilibili timestamp jump; the real run has no segment from which to create a jump.
- [x] An analysis failure preserves any deterministic material already available and keeps the timeline shell visible.
- [x] Rerunning analysis reuses transcript and evidence caches when they exist.
- [x] No API key appears in UI, IR, cache, or log output in the verified code paths.

## Real-source result

- Metadata: pass. The official public API returned the course title, uploader, duration, and 35 page chapters.
- Timestamped transcript: fail. The public subtitle list was empty and the endpoint indicated that subtitles require login for this source.
- Video/frame/signal stages: not run after the first unavailable stage, by design.
- Stop reason: `source_unavailable: timestamped transcript`.

## Decision

This is a verified partial prototype, not a complete real-BVID P0 acceptance pass. A BVID with a public timestamped subtitle track, or an explicitly approved ASR path, is required before claiming the full evidence-linked knowledge map is viable.
