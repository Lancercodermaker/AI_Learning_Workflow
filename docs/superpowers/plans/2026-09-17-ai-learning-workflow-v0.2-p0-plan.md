# AI Learning Workflow v0.2 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build and verify a real Bilibili BVID-to-Groundtruth Timeline vertical slice with a map-first workbench, timestamp-preserving evidence, structured IR, cacheable pipeline stages, and provider-neutral LLM analysis.

**Architecture:** A single TypeScript repository contains a Node HTTP API, a Vite/React workbench, material-local cache files, and independently testable pipeline stages. Deterministic ingestion, transcript normalization, segmentation, frame selection, and evidence persistence are separate from the LLM Gateway, which exposes OpenCode, CommandCode, and DeepSeek through one contract.

**Tech Stack:** Node.js 24, TypeScript, React, Vite, Node http server, zod, Vitest, ffmpeg-static, sharp, pixelmatch, tesseract.js, and Python 3.10 for yt-dlp process execution.

---

## Scope and execution rules

This plan covers P0 only. It does not implement podcast/TTS, text-mode parsing, authentication, collaboration, a full LMS, or the P1 User Knowledge Model and Learning Route. P1 extension fields may exist in the IR but remain absent until P0 passes on a real video.

The implementation must run the media feasibility spike before claiming the product slice is viable. The first real run requires a user-supplied BVID stored only in the shell variable LEARNING_BVID; it must not be committed to source or logs if it identifies private material.

Use test-first steps for domain logic. Keep commits small and scoped to the task named in each commit step. Do not commit .env, API keys, downloaded source video, extracted frames, or .superpowers companion files.

## File map

The implementation will create these focused units:

~~~text
package.json
tsconfig.json
vite.config.ts
index.html
.gitignore

src/
├── app/
│   ├── config.ts
│   ├── http.ts
│   └── version.ts
├── domain/
│   ├── errors.ts
│   ├── ir.ts
│   └── material-store.ts
├── llm/
│   ├── gateway.ts
│   ├── http-adapter.ts
│   ├── opencode-adapter.ts
│   ├── commandcode-adapter.ts
│   ├── deepseek-adapter.ts
│   └── analysis-prompts.ts
├── pipeline/run-pipeline.ts
├── video/
│   ├── bilibili/client.ts
│   ├── transcript/normalize.ts
│   ├── segmentation/segment.ts
│   └── evidence/
│       ├── frame-extractor.ts
│       ├── frame-signals.ts
│       └── frame-selector.ts
├── server.ts
└── ui/
    ├── App.tsx
    ├── api.ts
    ├── styles.css
    └── main.tsx

scripts/spike/media-baseline.ts
experiments/README.md
tests/
├── app/version.test.ts
├── domain/ir.test.ts
├── domain/material-store.test.ts
├── transcript/normalize.test.ts
├── segmentation/segment.test.ts
├── evidence/frame-selector.test.ts
├── llm/gateway.test.ts
├── pipeline/run-pipeline.test.ts
└── fixtures/
    ├── transcript.json
    ├── metadata.json
    └── learning-material.json
~~~

## Task 1: Scaffold the repository and establish a red test baseline

**Files:**

- Create: package.json
- Create: tsconfig.json
- Create: vite.config.ts
- Create: index.html
- Create: .gitignore
- Create: src/app/version.ts
- Create: tests/app/version.test.ts

- [ ] **Step 1: Create the package manifest and install dependencies**

Run:

~~~powershell
npm init -y
npm install react react-dom zod ffmpeg-static sharp pixelmatch tesseract.js
npm install -D @types/node @types/react @types/react-dom @vitejs/plugin-react concurrently jsdom tsx typescript vite vitest
npm pkg set type=module
npm pkg set scripts.dev="concurrently \\"vite --host 127.0.0.1\\" \\"tsx src/server.ts\\""
npm pkg set scripts.server="tsx src/server.ts"
npm pkg set scripts.build="tsc --noEmit && vite build"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.spike:media="tsx scripts/spike/media-baseline.ts"
~~~

- [ ] **Step 2: Add strict TypeScript configuration**

Create tsconfig.json:

~~~json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "scripts", "tests", "vite.config.ts"]
}
~~~

- [ ] **Step 3: Add Vite proxy and document shell**

Create vite.config.ts:

~~~ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4310", "/media": "http://127.0.0.1:4310" },
  },
});
~~~

Create index.html with a root div, viewport metadata, description, title, and script source /src/ui/main.tsx.

- [ ] **Step 4: Ignore secrets, generated media, and companion files**

Create .gitignore:

~~~gitignore
node_modules/
dist/
.env
.env.*
!.env.example
data/
experiments/*.json
.superpowers/
~~~

- [ ] **Step 5: Write the failing test**

Create tests/app/version.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../src/app/version";

describe("application version", () => {
  it("exposes the approved workflow version", () => {
    expect(APP_VERSION).toBe("0.2.0");
  });
});
~~~

Run npm test -- tests/app/version.test.ts. Expected: FAIL because src/app/version.ts does not exist.

- [ ] **Step 6: Implement and verify the version constant**

Create src/app/version.ts:

~~~ts
export const APP_VERSION = "0.2.0" as const;
~~~

Run npm test -- tests/app/version.test.ts. Expected: PASS. Commit:

~~~powershell
git add package.json package-lock.json tsconfig.json vite.config.ts index.html .gitignore src/app/version.ts tests/app/version.test.ts
git commit -m "chore: scaffold learning workflow app"
~~~

## Task 2: Run the bounded real-video media spike

**Files:**

- Create: scripts/spike/media-baseline.ts
- Create: experiments/README.md

- [ ] **Step 1: Define the experiment record and stop conditions**

Create experiments/README.md describing that each sanitized JSON record stores tool availability, source access, subtitle availability, frame extraction status, signal counts, and manual observations. It must prohibit API keys, cookies, private URLs, and downloaded source media. The spike passes only when one real public teaching video produces timestamped transcript material, a source frame set, an inspectable semantic segment, and comparisons for scene-only, frame-difference-only, and semantic-plus-visual/OCR selection. Stop after one video and two retries per failed stage.

- [ ] **Step 2: Implement the spike runner**

Create scripts/spike/media-baseline.ts with the CLI argument --bvid and this result shape:

~~~ts
type SpikeResult = {
  bvid: string;
  started_at: string;
  tools: { yt_dlp: boolean; ffmpeg: boolean; ocr: boolean };
  source: { metadata: "pass" | "fail"; transcript: "pass" | "fail"; video: "pass" | "fail" };
  transcript_cues: number;
  fixed_windows: number;
  semantic_boundaries: number;
  frame_candidates: number;
  selected_frames: number;
  comparisons: {
    scene_only: string;
    frame_difference_only: string;
    semantic_visual_ocr: string;
  };
  observations: string[];
  stop_reason?: string;
};
~~~

Invoke python -m yt_dlp --dump-single-json --write-subs --write-auto-subs --sub-langs all --skip-download for metadata/subtitle discovery. Use ffmpeg-static for a bounded frame sample and an extractOcrText(path) seam for OCR. Write one sanitized experiments JSON record. Pass the BVID as an argument, never by interpolating it into shell source.

- [ ] **Step 3: Run the tool and source check**

Set the real user-provided BVID locally and run:

~~~powershell
$env:LEARNING_BVID = 'BVxxxxxxxxxxxxxxxxxxxxxxxx'
npm run spike:media -- --bvid $env:LEARNING_BVID
~~~

Expected: a JSON record or a typed stop reason identifying the first unavailable stage. The command must not print AI_API_KEY.

- [ ] **Step 4: Evaluate the spike**

Pass only if metadata, timestamped transcript, real frame extraction, and semantic-plus-visual/OCR comparison are inspectable. If source access fails, record the failure and choose a replacement media path before continuing. Do not fabricate screenshots.

- [ ] **Step 5: Commit the harness and safe record**

~~~powershell
git add scripts/spike/media-baseline.ts experiments/README.md experiments/2026-09-17-BV1fixture.json
git commit -m "test: establish real video media baseline"
~~~

Commit a generated record only when it contains no sensitive URL, credential, cookie, or private material reference.

## Task 3: Implement the Learning IR and material-local store

**Files:**

- Create: src/domain/ir.ts
- Create: src/domain/errors.ts
- Create: src/domain/material-store.ts
- Create: tests/domain/ir.test.ts
- Create: tests/domain/material-store.test.ts
- Create: tests/fixtures/learning-material.json

- [ ] **Step 1: Write failing IR tests**

Create tests/domain/ir.test.ts. Test that a material with schema_version 0.2, Bilibili source, timestamped transcript, evidence frame, and a SOURCE_CLAIM parses successfully. Test that a claim with no transcript reference and no evidence timestamp is rejected.

- [ ] **Step 2: Run the test and verify failure**

Run npm test -- tests/domain/ir.test.ts. Expected: FAIL because LearningMaterialSchema does not exist.

- [ ] **Step 3: Implement schemas and typed stage state**

Create src/domain/ir.ts with Zod schemas for Chapter, TranscriptCue, EvidenceFrame, Claim, KnowledgeSegment, PipelineState, MaterialAnalysis, and LearningMaterialIR. Enforce non-negative times, end greater than start, and claim provenance. Add validateMaterialReferences(material) to require segment transcript/frame references to exist.

Create src/domain/errors.ts:

~~~ts
export type PipelineStage = "ingest" | "transcript" | "segmentation" | "frames" | "evidence" | "analysis" | "render";

export class PipelineError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}
~~~

- [ ] **Step 4: Implement material-local persistence**

Create MaterialStore(rootDir) in src/domain/material-store.ts with:

~~~ts
getMaterialDir(materialId: string): string;
readStage<T>(materialId: string, stage: string): Promise<T | null>;
writeStage<T>(materialId: string, stage: string, value: T): Promise<void>;
readLearningMaterial(materialId: string): Promise<LearningMaterialIR | null>;
writeLearningMaterial(material: LearningMaterialIR): Promise<void>;
appendLog(materialId: string, entry: { stage: PipelineStage; status: "start" | "pass" | "fail"; message: string; at: string }): Promise<void>;
~~~

Store under data/materials/<safe-material-id>/, write JSON atomically through a temporary sibling file followed by rename, write logs as JSON lines, and reject path separators or .. in material IDs.

- [ ] **Step 5: Add store tests and commit**

Test round-trip JSON, safe path rejection, atomic stage write, and log append. Run:

~~~powershell
npm test -- tests/domain/ir.test.ts tests/domain/material-store.test.ts
~~~

Expected: PASS. Commit:

~~~powershell
git add src/domain tests/domain tests/fixtures/learning-material.json
git commit -m "feat: add learning material IR and cache store"
~~~

## Task 4: Implement BVID metadata and timestamped transcript ingestion

**Files:**

- Create: src/video/bilibili/client.ts
- Create: src/video/transcript/normalize.ts
- Create: tests/fixtures/metadata.json
- Create: tests/fixtures/transcript.json
- Create: tests/transcript/normalize.test.ts

- [ ] **Step 1: Capture sanitized fixtures from the successful spike**

Keep title, uploader, duration, description, chapters, cue start/end/text, and source kind. Replace unstable identifiers with BV1fixture. Do not store cookies or authorization headers.

- [ ] **Step 2: Write failing transcript normalization tests**

Test sorting by start time, discarding only end <= start, preserving source text, stable IDs t0001 and t0002, and rejecting overlap within the same source with the message overlapping transcript cues.

- [ ] **Step 3: Implement normalizeTranscript**

Create src/video/transcript/normalize.ts. Sort by start time, discard only invalid zero-length cues, preserve original text byte-for-byte, assign stable IDs, and throw on same-source overlap. Do not merge different sources in this function.

- [ ] **Step 4: Implement the Bilibili client**

Create src/video/bilibili/client.ts:

~~~ts
export type BilibiliClient = {
  fetchMaterial(bvid: string): Promise<{ metadata: RawMetadata; subtitleTracks: SubtitleTrack[]; videoUrl?: string }>;
};
~~~

Validate ^BV[0-9A-Za-z]+$, use fetch with AbortSignal.timeout, normalize only fields observed in the spike fixtures, and throw PipelineError("ingest", code, message, retryable) for HTTP failures. Apply subtitle priority official, platform, then ASR seam. If no subtitle exists, return an empty track list and a typed warning; never fabricate transcript text.

- [ ] **Step 5: Run tests and commit ingestion**

~~~powershell
npm test -- tests/transcript/normalize.test.ts
npm run build
git add src/video/bilibili src/video/transcript tests/transcript tests/fixtures/metadata.json tests/fixtures/transcript.json
git commit -m "feat: ingest timestamped Bilibili transcript"
~~~

Expected: PASS and successful build.

## Task 5: Implement transcript-first Knowledge Segment boundaries

**Files:**

- Create: src/video/segmentation/segment.ts
- Create: tests/segmentation/segment.test.ts

- [ ] **Step 1: Write segmentation tests**

Use four cues: background, “接下来讲 Cross Entropy”, an IDE-only visual change that continues the same topic, and “最后总结”. Add chapters 0–4 and 4–16 plus a visual boundary at 8. Assert three segments with the middle segment spanning 4–12. Add a one-cue test asserting the segment stays within cue time.

- [ ] **Step 2: Implement segmentTranscript**

Create segmentTranscript({ transcript, chapters, visualBoundaries }) returning KnowledgeSegment[] without claims or frames. Priority is chapter boundaries, semantic phrases matching 接下来|第二个|另外|这里要注意|举个例子|总结|最后 and English equivalents, a 45-second minimum for materials longer than 10 minutes, then visual boundaries only when they do not split a transcript topic window. Assign V01, V02, and include every cue once. Record boundary reasons for experiment output.

- [ ] **Step 3: Run tests and commit**

~~~powershell
npm test -- tests/segmentation/segment.test.ts
git add src/video/segmentation tests/segmentation
git commit -m "feat: add transcript-first knowledge segmentation"
~~~

Expected: PASS.

## Task 6: Extract frames and select representative evidence

**Files:**

- Create: src/video/evidence/frame-extractor.ts
- Create: src/video/evidence/frame-signals.ts
- Create: src/video/evidence/frame-selector.ts
- Create: tests/evidence/frame-selector.test.ts

- [ ] **Step 1: Write selector tests**

Test one frame per segment, 15-second minimum distance, duplicate suppression, and selection of a complete formula frame over a visually noisy near-duplicate. Test that visual novelty alone remains inside the existing Segment and cannot create another Segment.

- [ ] **Step 2: Implement bounded extraction**

Create extractFrames(videoPath, ranges, outputDir). Invoke ffmpeg-static through spawn, never a shell string. Extract at most one frame every 5 seconds inside each Segment range, cap each range at 30 candidates, use stable file names, and convert process failures to PipelineError("frames", "FFMPEG_FAILED", message, true).

- [ ] **Step 3: Implement signal scoring**

Create frame-signals.ts:

~~~ts
export type FrameSignals = { visual_change: number; ocr_change: number; semantic_boundary: number };
export function scoreFrameSignals(previousImage: Buffer, currentImage: Buffer, previousOcr: string, currentOcr: string, semanticBoundary: number): FrameSignals;
~~~

Use sharp to resize before pixel comparison, pixelmatch for normalized visual-change, normalized token difference for OCR-change, and the supplied semantic boundary score. Put OCR behind an interface so selector tests do not require language data.

- [ ] **Step 4: Implement selection**

Create frame-selector.ts and rank candidates inside an existing Segment using:

~~~text
0.25 * visual_change + 0.35 * ocr_change + 0.40 * semantic_boundary
~~~

Apply minimum temporal distance, exact/near duplicate suppression, and one-frame default. Return two or three only for derivation, code progression, chart explanation, or before/after comparison when each frame adds a distinct state.

- [ ] **Step 5: Run tests and commit**

~~~powershell
npm test -- tests/evidence/frame-selector.test.ts
git add src/video/evidence tests/evidence
git commit -m "feat: select segment-aware groundtruth frames"
~~~

Expected: PASS.

## Task 7: Implement the provider-neutral LLM Gateway

**Files:**

- Create: src/llm/gateway.ts
- Create: src/llm/http-adapter.ts
- Create: src/llm/opencode-adapter.ts
- Create: src/llm/commandcode-adapter.ts
- Create: src/llm/deepseek-adapter.ts
- Create: src/llm/analysis-prompts.ts
- Create: tests/llm/gateway.test.ts

- [ ] **Step 1: Write Gateway contract tests**

Use a mocked fetch to test a valid OpenAI-compatible response and a malformed response. Assert valid claim provenance, exactly one repair retry, a final LLM_SCHEMA_INVALID error, and no API key in the error or log payload.

- [ ] **Step 2: Define the contract**

Create src/llm/gateway.ts:

~~~ts
export type ProviderName = "opencode" | "commandcode" | "deepseek";
export type ProviderConfig = { provider: ProviderName; baseUrl: string; apiKey: string; model: string; timeoutMs: number };
export type SegmentAnalysisInput = { segmentId: string; transcript: Array<{ id: string; start: number; end: number; text: string; source: string }>; evidenceTimestamps: number[] };
export type AnalysisGateway = { analyze(input: SegmentAnalysisInput): Promise<{ summary: string; claims: Array<{ claim: string; type: "SOURCE_CLAIM" | "AUTHOR_INTERPRETATION" | "AGENT_INFERENCE"; transcript_refs: string[]; evidence_timestamps: number[] }> }> };
export function createGateway(config: ProviderConfig): AnalysisGateway;
~~~

Load AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL, and AI_TIMEOUT_MS in src/app/config.ts. Fail fast on missing values. Never place the key in thrown messages, artifacts, or logs.

- [ ] **Step 3: Implement HTTP and provider mappings**

Use fetch with an abort timeout. Send model, system prompt, user content, and requested JSON schema. Normalize the response to a string. Each of OpenCode, CommandCode, and DeepSeek gets a mapping function. Start with the observed OpenAI-compatible response shape; if a provider differs, adapt only its adapter from a sanitized response fixture.

- [ ] **Step 4: Add the grounded analysis prompt**

The prompt must require JSON only, preserve transcript/evidence references, distinguish SOURCE_CLAIM, AUTHOR_INTERPRETATION, and AGENT_INFERENCE, never invent timestamps, and say evidence is insufficient when needed.

- [ ] **Step 5: Add retry and validation**

Parse with the analysis schema. On parse failure, send one repair request with the invalid output and same source context. On second failure, throw PipelineError("analysis", "LLM_SCHEMA_INVALID", message, false). Retry 408, 429, and 5xx once; do not retry 401, 403, or missing configuration.

- [ ] **Step 6: Run contract tests and commit**

~~~powershell
npm test -- tests/llm/gateway.test.ts
git add src/llm src/app/config.ts tests/llm
git commit -m "feat: add provider-neutral llm gateway"
~~~

## Task 8: Orchestrate the cacheable P0 pipeline and HTTP API

**Files:**

- Create: src/pipeline/run-pipeline.ts
- Create: src/app/http.ts
- Create: src/server.ts
- Create: tests/pipeline/run-pipeline.test.ts

- [ ] **Step 1: Write pipeline tests**

Test that forceStages ["analysis"] reuses transcript and frames, and that an analysis failure returns status partial, current_stage analysis, prior evidence, and a sanitized error.

- [ ] **Step 2: Implement orchestration**

Inject ingest, transcript, segment, evidence, and analysis dependencies. Before each stage read its cache key; after success write only that stage. Log stage start/pass/fail. Wrap unknown errors as PipelineError, preserve prior outputs, set partial when evidence exists and failed otherwise, and return the partial IR.

- [ ] **Step 3: Implement Node HTTP routes**

Create src/app/http.ts and src/server.ts using Node http:

~~~text
POST /api/materials
  body: { "bvid": "BV1fixture" }
  response: { "material_id": "bilibili:BV1fixture", "status": "queued" }

GET /api/materials/:materialId
  response: LearningMaterialIR

POST /api/materials/:materialId/analyze
  response: LearningMaterialIR

GET /media/:materialId/:file
  response: local cached frame with a safe path check
~~~

Keep jobs in Map<string, Promise<void>>, return 202 for newly queued materials and 409 for an already-running material, validate body size to 1 KB with Zod, enforce safe media paths, and return { error: { code, message, stage } } without stack traces or secrets.

- [ ] **Step 4: Run tests and commit**

~~~powershell
npm test -- tests/pipeline/run-pipeline.test.ts
npm run build
git add src/pipeline src/app/http.ts src/server.ts tests/pipeline
git commit -m "feat: add cacheable learning pipeline api"
~~~

Expected: PASS and successful build.

## Task 9: Build the map-first React workbench

**Files:**

- Create: src/ui/main.tsx
- Create: src/ui/App.tsx
- Create: src/ui/api.ts
- Create: src/ui/styles.css

- [ ] **Step 1: Add entry point and API client**

Create main.tsx with StrictMode, createRoot, App, and styles.css. Create api.ts with createMaterial(bvid), getMaterial(id), and rerunAnalysis(id), using fetch and the typed error shape.

- [ ] **Step 2: Implement map-first state and rendering**

Use state values bvid, material, selectedNode, and error. Render BVID form/status, Material Profile, Knowledge Map, and Groundtruth Timeline in that order. Selecting a node filters related segments while retaining “showing X / Y”. Each card shows time range, topic, screenshot when available, summary, provenance labels, transcript evidence time, and a Bilibili Jump to URL with ?t=seconds.

When evidence exists but analysis fails, keep the timeline visible with an inline AI analysis failed message and retry button. Never generate placeholder evidence imagery.

- [ ] **Step 3: Add accessible responsive styling**

Use a dark header, compact metadata strip, two-column desktop layout, single-column mobile layout, real buttons, visible focus styles, semantic headings, topic-derived alt text, and 44px minimum interactive targets.

- [ ] **Step 4: Preview and verify fixture behavior**

Run npm run build and npm run dev. Open http://localhost:5173, load a fixture IR through a temporary development-only seed, verify map-before-timeline order, node filtering, evidence labels, and analysis failure rendering. Remove the seed route before commit.

- [ ] **Step 5: Commit the workbench**

~~~powershell
git add src/ui
git commit -m "feat: add map-first evidence workbench"
~~~

## Task 10: Run the complete real-BVID P0 acceptance pass

**Files:**

- Create: tests/fixtures/p0-acceptance-checklist.md
- Modify: experiments/README.md with final run link and limitations

- [ ] **Step 1: Configure providers safely**

Create local .env from .env.example with one provider, model, base URL, and API key. Verify only AI_PROVIDER, AI_MODEL, and AI_BASE_URL. Do not print AI_API_KEY. Run one Gateway contract test before the real material.

- [ ] **Step 2: Run the real BVID**

~~~powershell
$env:LEARNING_BVID = 'BVxxxxxxxxxxxxxxxxxxxxxxxx'
npm run dev
~~~

Submit through the UI. Record only material ID and stage status. Confirm cache contains metadata, transcript, segments, frames, and analysis without secrets.

- [ ] **Step 3: Execute the browser checklist**

Create tests/fixtures/p0-acceptance-checklist.md:

~~~markdown
# P0 acceptance checklist

- [ ] BVID input accepted and normalized.
- [ ] Material Profile renders title, duration, and source.
- [ ] Knowledge Map renders before the long timeline.
- [ ] Selecting a map node narrows related timeline segments.
- [ ] Every major segment has start/end, topic, transcript references, and a representative frame or a clearly reported unavailable state.
- [ ] Important claims show a source type and timestamp/reference.
- [ ] Jump to points to the original Bilibili timestamp.
- [ ] A failed analysis preserves deterministic transcript and evidence.
- [ ] Rerunning analysis reuses transcript and frames.
- [ ] No API key appears in UI, IR, cache, or log output.
~~~

- [ ] **Step 4: Record the signal comparison**

Update the experiment record with observations for scene-only, frame-difference-only, and semantic-plus-visual/OCR selection. Include original assumption, observed result, reason for any design change, and final baseline weights. If any kill criterion is met, stop and report the failing stage instead of calling P0 complete.

- [ ] **Step 5: Run full verification**

~~~powershell
npm test
npm run build
git status --short
~~~

Expected: all tests pass, build succeeds, and only intentionally untracked local .env, data, and .superpowers remain.

- [ ] **Step 6: Commit acceptance evidence**

~~~powershell
git add tests/fixtures/p0-acceptance-checklist.md experiments/README.md
git commit -m "test: verify real BVID groundtruth timeline"
~~~

## Task 11: Fresh review and completion gate

**Files:**

- Review all P0 files and the final experiment record.

- [ ] **Step 1: Run a fresh diff review**

~~~powershell
git diff HEAD~1 --stat
git diff --check
git status --short
~~~

Confirm no keys, downloaded media, private URLs, or .superpowers files are staged.

- [ ] **Step 2: Verify the completion claim**

Report P0 prototype complete only when the real BVID checklist, full tests, build, and signal comparison pass. Otherwise report the exact failing stage and classify it as environment, implementation, configuration, assumption, architecture, or unknown.

- [ ] **Step 3: Prepare the P1 handoff without implementing it**

Record Knowledge Delta, User Knowledge Model, Personal Knowledge Gap, Minimal Prerequisite Graph, and Learning Route as next candidates. Do not add their UI or persistence behavior to this plan.

## Plan self-review

- Spec coverage: BVID ingest, timestamped transcript, transcript-first segmentation, frame signals, representative selection, structured IR, provenance, cache, provider-neutral Gateway, map-first UI, failure visibility, real-video comparison, and automated/browser acceptance each have a task.
- Scope: text mode, podcast/TTS, authentication, collaboration, and P1 learning-model features remain excluded.
- Type consistency: KnowledgeSegment, EvidenceFrame, Claim, PipelineState, PipelineError, ProviderConfig, and runPipeline are defined before downstream use.
- Completeness scan: every instruction is concrete; the real BVID is an execution input supplied through LEARNING_BVID, not an invented source.
- Verification: each code-bearing task starts with a failing test or explicit media experiment, ends with a focused command, and has a scoped commit.


Expected: PASS.
