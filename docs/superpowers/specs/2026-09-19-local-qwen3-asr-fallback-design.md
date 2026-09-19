# Local Qwen3-ASR Fallback Design

**Date:** 2026-09-19  
**Status:** Proposed  
**Scope:** AI Learning Workflow v0.2 P0 follow-up

## Goal

When a Bilibili material has no public timestamped subtitle track, generate a timestamped transcript locally with `Qwen/Qwen3-ASR-0.6B`, then feed the result through the existing segmentation, knowledge-map, and analysis pipeline. The ASR runtime must be lazy: normal application startup and subtitle-backed materials must not load the ASR model.

## Non-goals

- Replace the existing public-subtitle path.
- Add cloud speech-to-text or send source audio to a third party.
- Claim confidence values that Qwen does not return.
- Solve full video-frame evidence extraction in this change.
- Commit model weights, downloaded media, or user credentials.

## Current boundary

The Node server currently selects `source.subtitleTracks[0]?.cues ?? []`. An empty subtitle list therefore reaches `NO_TRANSCRIPT`. The IR already accepts `TranscriptCue.source = "asr"`, and the Bilibili material type already has an ASR subtitle-track source seam. The existing media spike also establishes a safe `yt-dlp` plus `ffmpeg-static` process pattern.

## Architecture

The application remains Node/TypeScript-first. A long-lived local Python worker is created only when the transcript stage needs ASR:

```text
BVID
  |
  v
Bilibili metadata + public subtitle discovery
  | subtitles available                     | no subtitles
  v                                          v
existing transcript path              media resolver
                                             |
                                             v
                                      cached local audio
                                             |
                                             v
                                      Python ASR worker
                                      (lazy model load)
                                             |
                                             v
                                      timestamped ASR cues
                                             |
                                             v
                          existing segmentation -> map -> analysis
```

### Node responsibilities

- Keep the current subtitle-first behavior.
- Resolve a Bilibili audio file only for the ASR fallback path.
- Start one Python worker with `shell: false` and an explicit `ASR_PYTHON` executable.
- Send newline-delimited JSON requests and parse newline-delimited JSON responses.
- Cache the audio and transcript stages through `MaterialStore`.
- Convert worker failures into typed, sanitized `PipelineError` values.
- Never place API keys, cookies, signed media URLs, or full subprocess payloads in logs.

### Python worker responsibilities

- Start without loading model weights.
- On the first `transcribe` request, load `Qwen/Qwen3-ASR-0.6B` and `Qwen/Qwen3-ForcedAligner-0.6B`.
- Reuse the loaded models for subsequent requests in the same process.
- Call the official `qwen_asr` interface with `return_time_stamps=True`.
- Normalize word/segment timestamps into `{start, end, text, source: "asr"}` cues.
- Return structured errors without stack traces or local secrets.
- Exit cleanly when the Node parent closes the worker.

The official Python package is installed with `pip install -U qwen-asr`. The existing `smartwatch-eating` Conda environment is the intended runtime because it already contains Python 3.11 and PyTorch. The exact Python executable is configured rather than hard-coded.

## Worker protocol

Request:

```json
{"id":"job-1","op":"transcribe","audio_path":"...","language":"Chinese","model":"Qwen/Qwen3-ASR-0.6B","aligner":"Qwen/Qwen3-ForcedAligner-0.6B","device":"auto"}
```

Success response:

```json
{"id":"job-1","ok":true,"language":"Chinese","cues":[{"start":0.0,"end":2.4,"text":"...","source":"asr"}]}
```

Failure response:

```json
{"id":"job-1","ok":false,"code":"ASR_INFERENCE_FAILED","message":"ASR inference failed"}
```

The protocol is intentionally line-oriented so the Node side can use a single persistent child process without introducing an HTTP service or exposing a local network port.

## Configuration

Add local-only settings to `.env.example` and load them into the server configuration:

```env
ASR_ENABLED=true
ASR_PYTHON=C:\Users\Fancy\anaconda3\envs\smartwatch-eating\python.exe
ASR_MODEL=Qwen/Qwen3-ASR-0.6B
ASR_ALIGNER=Qwen/Qwen3-ForcedAligner-0.6B
ASR_LANGUAGE=Chinese
ASR_DEVICE=auto
ASR_TIMEOUT_MS=1800000
```

`ASR_PYTHON` is required when the default system Python is not the configured Conda environment. `ASR_DEVICE=auto` selects CUDA when available and otherwise uses CPU. Model and aligner identifiers remain configurable for later experiments but default to the selected 0.6B pair.

## Fallback and error semantics

1. If a public subtitle track contains cues, return it and do not create the worker.
2. If subtitles are absent and `ASR_ENABLED` is false, preserve the existing `NO_TRANSCRIPT` behavior.
3. If subtitles are absent and ASR is enabled, resolve/cache audio and request transcription.
4. If ASR succeeds, normalize cues, mark the transcript source as `asr`, and continue.
5. If media resolution, worker startup, model loading, alignment, or timeout fails, return `ASR_UNAVAILABLE` or a more specific typed code at the transcript stage. Preserve metadata and show a recoverable failure in the UI.
6. An empty ASR result is a failure, not a successful empty transcript.

## UI behavior

- Show `ASR` as the transcript provenance when the fallback succeeds.
- Show a concise message when ASR is unavailable, including the next action: configure `ASR_PYTHON`, install `qwen-asr`, or retry.
- Keep the existing Profile → Knowledge Map → Groundtruth order.
- Do not display model internals, local file paths, or credentials.

## Validation

### Deterministic tests

- Subtitle cues bypass the worker and preserve their original source.
- Empty subtitles invoke the fallback exactly once and map worker cues to valid IR.
- Worker protocol parsing handles success, malformed JSON, worker errors, and timeouts.
- Missing `ASR_PYTHON` or disabled ASR produces a typed, sanitized error.
- ASR cues can be consumed by the existing segmentation tests.
- No API key or local media path is persisted in material IR or pipeline logs.

### Local inference spike

Before a full real-video run:

1. Install `qwen-asr` in `smartwatch-eating`.
2. Run the worker on a short local WAV sample.
3. Confirm first-request model loading, timestamped cues, CUDA selection, and a clean second request using the warm worker.
4. Record model/device/elapsed stage information without recording source media or secrets.

### Real acceptance

Run the existing no-subtitle BVID after the short-audio spike. The acceptance pass requires non-empty ASR cues, `source: "asr"`, transcript-derived segments, and a visible provenance label. If media download or model inference fails, report the exact stage and keep the material in a truthful partial/failed state.

## Risks and mitigations

- **Model installation or weight download fails:** fail clearly at ASR stage; provide a local install/weight-cache diagnostic.
- **VRAM is insufficient:** support CPU fallback and configurable device; do not silently switch to a cloud provider.
- **Long-video latency:** keep the existing asynchronous 202 job model, cache audio/transcript, and test a short sample before full runs.
- **Timestamp quality varies:** require timestamped output, preserve ASR provenance, and avoid unsupported confidence claims.
- **Bilibili media access changes:** isolate acquisition in a media resolver so the ASR worker remains provider-neutral.

## Acceptance gate

Implementation can be called complete only when:

- application startup does not load Qwen models;
- subtitle-backed material does not load Qwen models;
- no-subtitle material loads Qwen on demand and returns timestamped ASR cues;
- existing tests, build, and browser smoke checks pass;
- one real no-subtitle BVID reaches transcript-derived segmentation or reports a typed environment failure without fabricated content.
