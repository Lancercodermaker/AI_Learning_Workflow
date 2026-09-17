# AI Learning Workflow v0.2 Design

Date: 2026-09-16
Status: Design approved; implementation not started

## 1. Product intent

AI Learning Workflow v0.2 is a multimodal learning agent, not a generic summarizer. Its optimization target is:

```text
Effective Knowledge Gain / (Time + Attention Cost)
```

The first product slice prioritizes a trustworthy route from a Bilibili BVID to a skimmable, evidence-linked learning surface. The system compresses information while preserving reasoning, prerequisites, uncertainty, and traceability to the source material.

The first viewport is a working surface. It should help a learner build a material map in roughly 1–3 minutes before asking them to read a long explanation or enter interactive learning.

## 2. Scope

### In scope

The first implementation targets Video Mode with Bilibili BVID input:

```text
BVID
→ metadata
→ subtitles / transcript
→ semantic Knowledge Segments
→ representative original frames
→ structured evidence IR
→ map-first Groundtruth Timeline
```

The design reserves a future source abstraction for YouTube URLs, local video, PDF, PPT, lecture notes, Markdown, and long text, but does not implement those modes in the first slice.

### Explicitly out of scope for v0.2 P0

- Podcast, TTS, or generated audio courses
- Full LMS behavior
- Social or collaborative features
- App-owned authentication
- Microservices or distributed orchestration
- Unbounded web crawling
- Large persistent knowledge-base features
- Full interactive tutor, critical reading, and spaced repetition

Knowledge Delta, User Knowledge Model, Personal Knowledge Gap, and Learning Route are the next slice after the real P0 media path is proven. They may be represented by extension points in the IR, but P0 must not pretend to have verified user mastery.

## 3. Current project baseline

The workspace was audited before design:

- The project directory was empty.
- No source code, package manifest, README, or application configuration existed.
- No Git repository existed before design work; Git is now initialized so the approved design can be versioned.
- No reusable router, profile, skill, or agent framework was present.
- Node.js 24.15, Python 3.10, npm, and Git are available.
- `ffmpeg`, `ffprobe`, and `yt-dlp` are not currently available on PATH.
- No provider credentials were discovered or persisted by the agent.

Therefore the first implementation should be a small single-process full-stack application and a bounded real-video spike. It should not attempt to retrofit an absent framework.

## 4. Architecture

The application is a single repository with a browser workbench and a server-side pipeline. Exact framework selection is deferred to the implementation plan, but the boundary is fixed:

```text
React + TypeScript workbench
          │
          ▼
Node TypeScript API / job coordinator
          │
          ├── ingest: metadata, subtitles, video reference
          ├── transcript: timestamp-aligned cues
          ├── segmentation: semantic Knowledge Segments
          ├── frames: candidate extraction and scoring
          ├── evidence: representative frame selection
          ├── analysis: structured LLM output
          └── cache/logging: material-local artifacts
```

The pipeline is intentionally not distributed. Each stage has a clear input and output and can be rerun independently. Deterministic preprocessing is separated from probabilistic model analysis.

### Proposed module boundaries

```text
src/
├── app/                 HTTP routes, job lifecycle, runtime config
├── domain/
│   ├── ir/              Learning IR types and schema validation
│   ├── pipeline/        stage contracts and orchestration
│   └── errors/          typed stage failures
├── video/
│   ├── bilibili/        BVID parsing and source access
│   ├── transcript/      subtitle normalization and ASR seam
│   ├── segmentation/    semantic boundary baseline
│   └── evidence/        frame candidates and representative selection
├── llm/
│   ├── gateway/         provider-neutral contract
│   ├── opencode/        OpenCode adapter
│   ├── commandcode/     CommandCode adapter
│   └── deepseek/        DeepSeek adapter
├── render/              IR-to-UI view models
└── ui/                   map-first workbench components
```

The module layout is a guide, not a reason to create empty abstraction layers. A module should exist when it owns a stable contract or an independently testable failure boundary.

## 5. Structured Learning IR

Markdown is a renderer output, never the canonical intermediate representation.

### Material IR

```text
LearningMaterialIR {
  schema_version: "0.2"
  material: {
    id: string
    type: "video"
    source: {
      platform: "bilibili"
      bvid: string
      url: string
    }
    metadata: {
      title: string
      uploader?: string
      duration_seconds?: number
      description?: string
      chapters?: Chapter[]
    }
  }
  pipeline: PipelineState
  transcript: TranscriptCue[]
  segments: KnowledgeSegment[]
  evidence_frames: EvidenceFrame[]
  analysis?: MaterialAnalysis
}
```

### Transcript cue

```text
TranscriptCue {
  id: string
  start: number
  end: number
  text: string
  source: "official" | "platform" | "asr"
  confidence?: number
}
```

Original text is retained. Normalized text may be added for matching, but must not replace the source text.

### Knowledge Segment

```text
KnowledgeSegment {
  id: string
  start: number
  end: number
  topic: string
  transcript_refs: string[]
  evidence_frame_refs: string[]
  claims: Claim[]
  summary?: string
  importance?: "low" | "medium" | "high"
  recommended_original?: {
    start: number
    end: number
    reason: string
  }
}
```

The first segmenter uses transcript semantic boundaries and chapters as primary signals. Speaker transition phrases, scene changes, OCR/content changes, and fixed-duration windows are supporting signals or fallbacks, not the final semantic truth.

### Evidence frame

```text
EvidenceFrame {
  id: string
  timestamp: number
  path: string
  segment_ref: string
  reason: string
  signals: {
    visual_change?: number
    ocr_change?: number
    semantic_boundary?: number
  }
}
```

The frame path and timestamp are stable references within the material artifact directory. The selector applies minimum temporal distance, duplicate suppression, and one-frame-by-default limits. Two or three frames are allowed only when they materially represent a derivation, code progression, chart explanation, or before/after comparison.

### Claim provenance

```text
Claim {
  id: string
  claim: string
  type: "SOURCE_CLAIM" | "AUTHOR_INTERPRETATION" | "AGENT_INFERENCE"
  transcript_refs: string[]
  evidence_timestamps: number[]
}
```

The UI must visually distinguish source claims from interpretation and inference. An inference cannot be rendered as though the author said it.

## 6. Pipeline contracts and caching

```text
ingest
  input: BVID
  output: raw metadata + source references

transcript
  input: raw metadata/source references
  output: ordered TranscriptCue[]

segmentation
  input: TranscriptCue[] + chapters + optional visual hints
  output: KnowledgeSegment[] without claims

frame_candidates
  input: source video + segment time ranges
  output: candidate EvidenceFrame[]

representative_frame
  input: candidate frames grouped by segment
  output: selected EvidenceFrame refs

analysis
  input: segment context + transcript/evidence references
  output: schema-validated analysis fields

render
  input: LearningMaterialIR
  output: map-first workbench view
```

Material-local cache layout:

```text
data/materials/{bvid}/
├── metadata.json
├── subtitles.json
├── transcript.json
├── source/
├── frames/
├── segments.json
├── analysis.json
└── pipeline.log
```

Raw metadata, subtitles, transcript, and extracted frames are retained when possible. Re-running analysis must not re-download or re-extract an unchanged material. Cache keys include source identity and stage version so algorithm changes can invalidate only the affected stage.

The pipeline records `current_stage`, completed stages, timestamps, and a typed error. A later-stage failure must preserve earlier results and allow a partial evidence view.

## 7. LLM Gateway

The learning pipeline calls a provider-neutral contract:

```text
analyzeSegment(
  segment_context,
  output_schema,
  provider_config
) → validated_analysis
```

Adapters:

```text
ProviderAdapter
├── OpenCodeAdapter
├── CommandCodeAdapter
└── DeepSeekAdapter
```

The Gateway owns:

- provider selection
- authentication headers
- request/response mapping
- timeout and retry policy
- structured output validation
- prompt version recording
- provider/model metadata recording
- secret-safe logging

The adapter contract must support both OpenAI-compatible HTTP APIs and provider-specific mapping if any of the three services differs. No provider SDK is required for the core design.

Configuration is environment-only:

```text
AI_PROVIDER=deepseek
AI_BASE_URL=...
AI_API_KEY=...
AI_MODEL=...
AI_TIMEOUT_MS=...
```

The implementation must never print `AI_API_KEY`, persist it in IR, or include full sensitive request payloads in logs. Provider switching is explicit; the system must not silently switch models after a failure because model differences can change segmentation or claim interpretation.

For malformed output:

1. Perform one repair-oriented JSON retry.
2. If validation still fails, record a typed analysis failure.
3. Keep deterministic transcript, segments, and evidence visible.
4. Show that AI analysis failed rather than fabricating a fallback claim.

The model may generate profile, map labels, summaries, claims, and replay recommendations, but it cannot mutate original transcript, timestamps, screenshots, or metadata.

## 8. Map-first workbench

The first viewport is organized as a working surface:

1. BVID input and processing status
2. Material Profile: title, duration, uploader, difficulty estimate, audience estimate, and value judgment
3. Knowledge Map: 5–15 nodes when available, with importance and route state
4. Groundtruth Timeline: segment cards containing topic, time, representative frame, summary, evidence tags, and replay action

The interaction model is:

- the Knowledge Map is the index;
- selecting a node filters or focuses related timeline segments without hiding the material context;
- each segment exposes its original timestamp and transcript references;
- `Jump to` targets the original video time range;
- source claim, author interpretation, and agent inference use distinct visual labels;
- a failed later stage leaves prior material visible with a clear status message.

The UI does not initially dump a giant summary. Long-form explanation and interactive learning are entered from a selected node or segment after the user has an overview.

## 9. P0 experiment and validation

Before full product implementation, run a bounded real-video spike using one real Bilibili teaching video.

### Required evidence

- BVID is accepted and normalized
- metadata retrieval produces a title and duration when available
- subtitle/transcript retrieval produces ordered, timestamped cues or a clearly reported failure
- a real source video or equivalent frame source can produce frames
- transcript-first segmentation produces inspectable boundaries
- representative-frame selection produces at least one usable frame for each major segment
- evidence timestamps align with transcript and segment ranges
- the configured provider returns schema-valid analysis for a small segment set

### Comparison

Log and manually inspect:

```text
scene detection only
frame difference only
semantic boundary + visual/OCR candidates
```

Compare false segment creation when a lecturer switches between slides, an IDE, and the slides again; missed formula/code/chart transitions; duplicate screenshots; and whether the selected frame actually represents the segment's knowledge value.

The experiment is an engineering baseline, not a claim of general algorithm quality. Findings must record the original assumption, observed result, reason for any design change, and revised approach.

### Kill criteria

Pause full implementation and redesign the route if:

- BVID material cannot be obtained reliably after the bounded spike;
- video data is available but frames cannot be extracted reliably;
- timestamp alignment cannot be preserved;
- semantic segmentation is no better than an acceptable fixed-window baseline;
- representative frames consistently follow visual novelty instead of knowledge value;
- structured output cannot be validated from all available providers.

## 10. Testing strategy

### Deterministic unit tests

- BVID normalization and invalid-input handling
- transcript ordering, overlap, and time validation
- segmentation boundary validity and non-overlap
- frame minimum-distance and duplicate suppression
- stable IR serialization and schema validation
- provenance label validation

### Provider contract tests

Use a mock HTTP server to test all adapters without live keys:

- valid structured response
- OpenAI-compatible response mapping
- provider-specific response mapping
- timeout
- retryable HTTP failure
- non-retryable authentication failure
- malformed JSON
- schema-invalid JSON
- secret-safe logging

### Pipeline tests

- cache hit skips completed stages
- algorithm version invalidates only affected stage
- partial results survive later-stage failure
- analysis regeneration reuses transcript and frames
- stage logs identify the failing boundary

### Browser acceptance test

With a fixture IR and one real or recorded pipeline result:

1. Enter a BVID.
2. Observe processing status.
3. See Material Profile and Knowledge Map.
4. Select a knowledge node.
5. Verify related timeline segments focus/update.
6. Verify screenshot, transcript evidence, and source labels.
7. Verify `Jump to` uses the segment timestamp.
8. Verify a failed analysis still renders deterministic evidence.

## 11. Implementation order

1. Collect the exact non-secret provider configuration and one real BVID.
2. Install or provide a supported frame-extraction path and run the bounded media spike.
3. Record spike results and adjust the segment/frame baseline if evidence requires it.
4. Scaffold the single-process TypeScript application.
5. Implement configuration validation and provider-neutral Gateway.
6. Implement BVID metadata/subtitle ingestion and material cache.
7. Implement transcript normalization and stage-level logging.
8. Implement semantic segmentation baseline.
9. Implement frame candidate extraction, scoring, and representative selection.
10. Implement Learning IR validation and analysis persistence.
11. Implement the map-first workbench and timeline interactions.
12. Run deterministic tests, provider contract tests, and browser acceptance tests.
13. Re-run the complete P0 path on the selected real BVID.
14. Only after P0 passes, design and implement Knowledge Delta, User Knowledge Model, Personal Gap, and Learning Route.

## 12. Open implementation inputs

The design is approved, but implementation needs two non-secret inputs:

- one real Bilibili teaching-video BVID for acceptance;
- provider configuration: provider name, model, and optional base URL for each available API. API keys must be supplied through local environment variables and must not be pasted into chat or committed.

## 13. Design decision record

The chosen approach is a provider-neutral HTTP Gateway rather than direct SDK calls or browser-side provider calls.

Reason:

- the project starts empty;
- the three APIs are independent services;
- the learning pipeline should not depend on one model vendor;
- server-side calls are required for secret safety, retries, caching, and long-running pipeline status;
- structured IR allows the provider to change without rewriting the renderer or evidence pipeline.

The chosen UI is a map-first cockpit because the primary user task is orientation and learning-route selection. Evidence remains visible as the proof layer directly below or beside the map, rather than being replaced by a generic summary.
