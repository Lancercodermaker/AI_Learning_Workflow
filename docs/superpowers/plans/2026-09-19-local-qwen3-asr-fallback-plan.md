# Local Qwen3-ASR Fallback Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a lazy local Qwen3-ASR-0.6B fallback that produces timestamped transcript cues when Bilibili exposes no public subtitles.

**Architecture:** Keep the Node/TypeScript pipeline as the source of truth. The transcript resolver first returns public subtitle cues; only an empty subtitle result starts a persistent Python JSONL worker. The worker lazily loads Qwen3-ASR-0.6B plus Qwen3-ForcedAligner-0.6B, returns normalized ASR cues, and is reused for later fallback jobs.

**Tech Stack:** Node 24, TypeScript, Vitest, Python 3.11 Conda, PyTorch, qwen-asr, Qwen3-ASR-0.6B, Qwen3-ForcedAligner-0.6B, yt-dlp, ffmpeg-static, JSONL over stdin/stdout.

**Design reference:** docs/superpowers/specs/2026-09-19-local-qwen3-asr-fallback-design.md

---

### Task 1: Establish the local ASR environment and deterministic protocol seam

**Files:**
- Modify: package.json
- Modify: .env.example
- Create: src/video/asr/types.ts
- Create: src/video/asr/protocol.ts
- Test: tests/asr/protocol.test.ts

- [ ] Step 1: Write the failing protocol tests

Add tests for a successful JSONL response, a worker error response, malformed JSON, and a response with a mismatched request id. The desired parser API is:

    export type AsrWorkerResponse =
      | { id: string; ok: true; language: string; cues: TranscriptCue[] }
      | { id: string; ok: false; code: string; message: string };

    export function parseAsrWorkerLine(line: string, expectedId: string): AsrWorkerResponse;

Run:

    npm test -- tests/asr/protocol.test.ts

Expected: FAIL because the protocol module does not exist.

- [ ] Step 2: Implement the protocol types and parser

Create src/video/asr/types.ts with request/response types and src/video/asr/protocol.ts with strict JSON parsing. Validate cue ranges and non-empty text. Convert malformed or mismatched responses to PipelineError('transcript', 'ASR_PROTOCOL_INVALID', ...) without including raw worker output.

- [ ] Step 3: Verify the protocol tests pass

Run:

    npm test -- tests/asr/protocol.test.ts

Expected: all protocol tests pass.

- [ ] Step 4: Add configuration names and a spike command

Add these settings to .env.example:

    ASR_ENABLED=true
    ASR_PYTHON=
    ASR_MODEL=Qwen/Qwen3-ASR-0.6B
    ASR_ALIGNER=Qwen/Qwen3-ForcedAligner-0.6B
    ASR_LANGUAGE=Chinese
    ASR_DEVICE=auto
    ASR_TIMEOUT_MS=1800000

Add "spike:asr": "tsx scripts/spike/asr-baseline.ts" to package.json. Do not add model weights or audio files to the repository.

- [ ] Step 5: Install the runtime dependency in the selected Conda environment

Run:

    conda run -n smartwatch-eating python -m pip install -U qwen-asr yt-dlp
    conda run -n smartwatch-eating python -c "import torch, qwen_asr; print(torch.__version__); print(qwen_asr.__file__)"

Expected: imports succeed. If CUDA is unavailable, record CPU fallback and continue with the same protocol.

- [ ] Step 6: Commit the protocol and environment seam

    git add package.json .env.example src/video/asr/types.ts src/video/asr/protocol.ts tests/asr/protocol.test.ts
    git commit -m "feat: add ASR worker protocol and config seam"

### Task 2: Add the lazy Python Qwen worker

**Files:**
- Create: scripts/asr/qwen_worker.py
- Create: scripts/asr/test_qwen_worker.py

- [ ] Step 1: Write failing Python unit tests

Test the pure normalization function with timestamp fixtures:

    def test_normalize_cues_preserves_timestamp_ranges_and_source():
        cues = normalize_cues([
            {"start": 0.0, "end": 1.5, "text": "第一句"},
            {"start": 1.5, "end": 3.0, "text": "第二句"},
        ])
        assert cues == [
            {"start": 0.0, "end": 1.5, "text": "第一句", "source": "asr"},
            {"start": 1.5, "end": 3.0, "text": "第二句", "source": "asr"},
        ]

Also test that empty text, non-positive ranges, and missing timestamps are rejected or skipped deterministically.

Run:

    conda run -n smartwatch-eating python -m unittest scripts/asr/test_qwen_worker.py

Expected: FAIL because the worker module does not exist.

- [ ] Step 2: Implement worker startup without model loading

Implement scripts/asr/qwen_worker.py with:

- module-level model = None and aligner = None;
- load_models(request) that imports torch and qwen_asr only on the first transcription request;
- Qwen3ASRModel.from_pretrained(request["model"], device_map=resolved_device, forced_aligner=request["aligner"], forced_aligner_kwargs=...);
- transcribe(audio=..., language=..., return_time_stamps=True);
- a JSONL stdin loop and one JSON response per request;
- stderr-only diagnostics with no full paths or input payloads;
- clean EOF handling.

ASR_DEVICE=auto chooses cuda:0 when CUDA is available and otherwise cpu. Use a CUDA-safe dtype, bfloat16 when supported and float32 otherwise. Do not load the model in module import or health-check paths.

- [ ] Step 3: Verify Python unit tests pass

    conda run -n smartwatch-eating python -m unittest scripts/asr/test_qwen_worker.py

Expected: all pure worker tests pass without downloading model weights.

- [ ] Step 4: Commit the worker

    git add scripts/asr/qwen_worker.py scripts/asr/test_qwen_worker.py
    git commit -m "feat: add lazy Qwen3 ASR worker"

### Task 3: Add a Node client with lazy process lifecycle

**Files:**
- Create: src/video/asr/worker-client.ts
- Test: tests/asr/worker-client.test.ts

- [ ] Step 1: Write failing client tests

Create a fake child-process seam and test:

1. createAsrWorkerClient() does not spawn a process.
2. The first transcribe() call spawns exactly once and writes one JSON request.
3. A second call reuses the same process.
4. A successful JSONL response becomes normalized cues.
5. Worker error, malformed output, exit, and timeout become sanitized PipelineError values.
6. close() ends the child process and clears the cached handle.

Run:

    npm test -- tests/asr/worker-client.test.ts

Expected: FAIL because the client does not exist.

- [ ] Step 2: Implement the minimal lazy client

Expose:

    export type AsrWorkerClient = {
      transcribe(input: { audioPath: string; language?: string }): Promise<TranscriptCue[]>;
      close(): void;
    };

Spawn with spawn(config.python, [workerPath], { shell: false, windowsHide: true }). Buffer stdout by line, route each request by id, reject pending requests on process exit, and enforce ASR_TIMEOUT_MS. Never log the API configuration or raw worker output.

- [ ] Step 3: Verify client tests pass

    npm test -- tests/asr/worker-client.test.ts
    npm test

Expected: focused tests and all existing tests pass.

- [ ] Step 4: Commit the client

    git add src/video/asr/worker-client.ts tests/asr/worker-client.test.ts
    git commit -m "feat: add lazy ASR worker client"

### Task 4: Resolve and cache Bilibili audio only for fallback

**Files:**
- Create: src/video/media/audio-resolver.ts
- Test: tests/video/audio-resolver.test.ts
- Modify: src/domain/material-store.ts

- [ ] Step 1: Write failing resolver tests

Test that the resolver validates a BVID before invoking a subprocess, builds an argument array with shell=false and no shell interpolation, writes into the material cache directory, returns an existing cached audio file without spawning again, and converts failed download/extraction into AUDIO_UNAVAILABLE.

Run:

    npm test -- tests/video/audio-resolver.test.ts

Expected: FAIL because the resolver does not exist.

- [ ] Step 2: Implement bounded, cacheable audio resolution

Use the configured Python executable to run python -m yt_dlp against https://www.bilibili.com/video/<BVID>. Download audio only, use the bundled ffmpeg-static location, and write the final audio file under the material directory. Reuse the safe BVID validation and process-spawn pattern from scripts/spike/media-baseline.ts; do not duplicate shell command strings.

The resolver returns { path: string }, never a signed URL. It must not write the path or source URL into public IR or pipeline messages.

- [ ] Step 3: Verify resolver tests pass

    npm test -- tests/video/audio-resolver.test.ts

Expected: all resolver tests pass.

- [ ] Step 4: Commit the resolver

    git add src/video/media/audio-resolver.ts tests/video/audio-resolver.test.ts src/domain/material-store.ts
    git commit -m "feat: add cacheable Bilibili audio resolver"

### Task 5: Integrate subtitle-first transcript fallback

**Files:**
- Create: src/video/transcript/resolve.ts
- Test: tests/transcript/resolve.test.ts
- Modify: src/server.ts
- Modify: src/app/config.ts

- [ ] Step 1: Write failing resolver integration tests

Test the public API resolveTranscript({ source, materialId }, { audio, asr }). Required cases:

- a non-empty subtitle track returns its cues and never calls audio or ASR;
- an empty subtitle list calls audio once, calls ASR once, and returns source=asr cues;
- disabled ASR returns the current no-transcript error;
- audio and worker errors produce typed transcript-stage errors.

Run:

    npm test -- tests/transcript/resolve.test.ts

Expected: FAIL because the resolver does not exist.

- [ ] Step 2: Implement ASR configuration parsing

Add a typed AsrConfig loader that validates ASR_ENABLED, ASR_PYTHON when ASR is enabled, model, aligner, language, device, and positive timeout values. Errors must say which setting is missing without printing its value.

- [ ] Step 3: Implement transcript resolution and server wiring

Create one transcript resolver per learning server. Pass it into runPipeline as the transcript dependency. Construct the audio resolver and lazy ASR worker client at server creation, but do not call either until subtitles are empty. Register worker cleanup on server close.

Keep NO_TRANSCRIPT for disabled ASR and use ASR_UNAVAILABLE for enabled-but-unusable ASR. Preserve the current analysis precondition that transcript cues must be non-empty.

- [ ] Step 4: Verify integration tests pass

    npm test -- tests/transcript/resolve.test.ts
    npm test
    npm run build

Expected: all tests pass and TypeScript/Vite build succeeds.

- [ ] Step 5: Commit the fallback integration

    git add src/video/transcript/resolve.ts tests/transcript/resolve.test.ts src/server.ts src/app/config.ts
    git commit -m "feat: add subtitle-first ASR transcript fallback"

### Task 6: Expose ASR provenance and recoverable UI errors

**Files:**
- Modify: src/ui/App.tsx
- Modify: src/ui/styles.css
- Test: tests/ui/App.test.tsx

- [ ] Step 1: Write failing UI tests

Add fixture cases for an ASR transcript showing an ASR provenance label, an ASR_UNAVAILABLE pipeline error showing a retry/configuration message, and an ordinary subtitle transcript continuing to show the existing map-first layout.

Run:

    npm test -- tests/ui/App.test.tsx

Expected: FAIL because the provenance label and ASR-specific error copy do not exist.

- [ ] Step 2: Implement minimal UI changes

Derive transcript provenance from the cue source and render it in Material Profile. Keep API keys, Python paths, and local audio paths out of the rendered UI. Reuse the existing retry action for recoverable ASR failures.

- [ ] Step 3: Verify UI tests and build

    npm test -- tests/ui/App.test.tsx
    npm run build

Expected: tests and build pass.

- [ ] Step 4: Commit the UI behavior

    git add src/ui/App.tsx src/ui/styles.css tests/ui/App.test.tsx
    git commit -m "feat: show ASR transcript provenance"

### Task 7: Run the short local ASR spike

**Files:**
- Create: scripts/spike/asr-baseline.ts
- Modify: experiments/README.md

- [ ] Step 1: Implement a non-secret spike command

Add npm run spike:asr -- --audio <local-audio-path> that launches the configured worker, runs one short audio file, runs a second request in the same process, and writes only sanitized JSON metrics: model id, device, cue count, first/second request elapsed time, and failure stage. Do not write audio paths, API keys, model cache paths, or transcript text.

- [ ] Step 2: Run the spike in the Conda environment

    $env:ASR_PYTHON = 'C:\Users\Fancy\anaconda3\envs\smartwatch-eating\python.exe'
    npm run spike:asr -- --audio 'C:\path\to\short-speech.wav'

Expected: the first request loads the model and returns non-empty timestamped cues; the second request reuses the warm worker. If the model cannot load, stop and record the exact environment failure before attempting a full video.

- [ ] Step 3: Commit only sanitized spike tooling and docs

    git add scripts/spike/asr-baseline.ts experiments/README.md
    git commit -m "test: add local ASR inference spike"

### Task 8: Run real no-subtitle acceptance and final verification

**Files:**
- Modify: tests/fixtures/p0-acceptance-checklist.md
- Create: experiments/2026-09-19-BV1DE421M7AZ-asr.json only if sanitized and useful

- [ ] Step 1: Run the real BVID through the application

Configure the Conda Python executable and one existing LLM provider locally, then start the server. Submit BV1DE421M7AZ from the UI or API. The expected route is metadata pass, public subtitle unavailable, ASR fallback, transcript cues, segmentation, and an analysis attempt.

- [ ] Step 2: Verify acceptance evidence

Confirm server startup does not load Qwen; subtitle-backed fixtures do not spawn the worker; a no-subtitle BVID starts the worker only at transcript fallback; transcript cues are non-empty and source=asr; segments reference ASR cue ids; UI displays ASR provenance; failures are typed and sanitized; and no API key, signed URL, local path, model cache path, or downloaded media is committed.

- [ ] Step 3: Run the complete verification suite

    npm test
    npm run build
    git diff --check
    git status --short

Expected: all tests pass, build succeeds, diff check is clean, and only intentional local environment files remain untracked or ignored.

- [ ] Step 4: Update the acceptance record and commit

Update the checklist with real evidence and commit only sanitized records:

    git add tests/fixtures/p0-acceptance-checklist.md experiments/2026-09-19-BV1DE421M7AZ-asr.json
    git commit -m "test: verify local ASR fallback on no-subtitle video"

- [ ] Step 5: Review the final diff

    git diff origin/main...HEAD --stat
    git diff origin/main...HEAD -- .env.example src scripts tests

Confirm model weights, audio, secrets, cookies, and private URLs are absent before pushing or creating a PR.

