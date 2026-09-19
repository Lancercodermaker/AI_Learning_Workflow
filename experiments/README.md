# Media baseline spike

This experiment is deliberately bounded to one public teaching video. A run may
download a short local sample into the operating system's temporary directory;
the sample is deleted before the process exits. The committed JSON record is a
sanitized audit artifact, not a media cache.

Each record stores only:

- tool availability;
- public source access status for metadata, transcript, and video;
- counts for timestamped cues, fixed windows, semantic boundaries, and frames;
- the comparison outcome for scene-only, frame-difference-only, and
  semantic-plus-visual/OCR selection;
- short manual or machine observations that do not contain source URLs.

Never place API keys, cookies, authorization headers, private URLs, signed media
URLs, or downloaded source media in this directory or in a committed record.

The spike stops after one video. Each failed stage is retried at most twice
after its first attempt, then the first unavailable stage is recorded as the
stop reason. The spike passes only when one real public teaching video produces
timestamped transcript material, a source frame set, an inspectable semantic
segment, and all three selection comparisons.

## Final run

The current real run is recorded in [2026-09-17-BV1DE421M7AZ.json](./2026-09-17-BV1DE421M7AZ.json).
Metadata access passed, but this source exposed no public timestamped subtitle
track. The runner stopped at the transcript stage, so it intentionally did not
fabricate frames, semantic segments, or signal comparisons. See the browser
acceptance checklist for the exact partial result and the next required source
condition.

## Local ASR fallback spike

The local fallback can be measured independently with a short local audio file:

```powershell
$env:ASR_ENABLED = 'true'
$env:ASR_PYTHON = 'C:\Users\<user>\anaconda3\envs\<env>\python.exe'
$env:ASR_MODEL = 'Qwen/Qwen3-ASR-0.6B'
$env:ASR_ALIGNER = 'Qwen/Qwen3-ForcedAligner-0.6B'
$env:ASR_LANGUAGE = 'Chinese'
$env:ASR_DEVICE = 'auto'
npm run spike:asr -- --audio C:\path\to\sample.wav
```

The command sends two requests through one persistent worker. The first request
includes lazy model initialization; the second checks warm-worker reuse. Its
sanitized JSON record contains only model, device, elapsed milliseconds, cue
counts, and a failure stage. It never records the audio path, transcript text,
API keys, or model-cache paths. Model weights are downloaded on the first real
run by `qwen-asr`; if that download fails, fix the local Hugging Face/network
access and rerun the same command.
