"""Persistent, lazy-loading Qwen3-ASR JSONL worker."""

from __future__ import annotations

import json
import math
import sys
from typing import Any


_MODEL: Any = None
_MODEL_CONFIG: tuple[str, str, str] | None = None


def configure_utf8_streams() -> None:
    """Keep JSONL responses lossless on Windows code pages."""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")


def normalize_cues(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    for item in items:
        start = item.get("start", item.get("start_time"))
        end = item.get("end", item.get("end_time"))
        text = item.get("text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        if not math.isfinite(float(start)) or not math.isfinite(float(end)) or float(start) < 0 or float(end) <= float(start):
            continue
        if not isinstance(text, str) or not text.strip():
            continue
        cues.append({
            "start": round(float(start), 3),
            "end": round(float(end), 3),
            "text": text.strip(),
            "source": "asr",
        })
    return cues


def resolve_device(requested: str, cuda_available: bool | None = None) -> str:
    if requested == "cpu":
        return "cpu"
    if requested == "cuda:0":
        return "cuda:0" if cuda_available is not False else "cpu"
    if requested != "auto":
        raise ValueError("unsupported ASR device")
    if cuda_available is None:
        import torch

        cuda_available = bool(torch.cuda.is_available())
    return "cuda:0" if cuda_available else "cpu"


def _load_models(request: dict[str, Any]) -> Any:
    global _MODEL, _MODEL_CONFIG
    model_name = str(request["model"])
    aligner_name = str(request["aligner"])
    device = resolve_device(str(request.get("device", "auto")))
    config = (model_name, aligner_name, device)
    if _MODEL is not None and _MODEL_CONFIG == config:
        return _MODEL

    import torch
    from qwen_asr import Qwen3ASRModel

    dtype = torch.bfloat16 if device.startswith("cuda") and torch.cuda.is_bf16_supported() else torch.float32
    _MODEL = Qwen3ASRModel.from_pretrained(
        model_name,
        dtype=dtype,
        device_map=device,
        max_inference_batch_size=8,
        max_new_tokens=512,
        forced_aligner=aligner_name,
        forced_aligner_kwargs={"dtype": dtype, "device_map": device},
    )
    _MODEL_CONFIG = config
    return _MODEL


def _timestamp_items(result: Any) -> list[dict[str, Any]]:
    timestamps = getattr(result, "time_stamps", None)
    items = getattr(timestamps, "items", timestamps)
    if items is None:
        return []
    return [
        {
            "start": getattr(item, "start_time", None),
            "end": getattr(item, "end_time", None),
            "text": getattr(item, "text", ""),
        }
        for item in items
    ]


def _transcribe(request: dict[str, Any]) -> dict[str, Any]:
    model = _load_models(request)
    language = str(request.get("language", "")).strip() or None
    results = model.transcribe(
        audio=str(request["audio_path"]),
        language=language,
        return_time_stamps=True,
    )
    if not results:
        raise RuntimeError("ASR returned no result")
    result = results[0]
    cues = normalize_cues(_timestamp_items(result))
    if not cues:
        raise RuntimeError("ASR returned no timestamped cues")
    return {
        "id": request["id"],
        "ok": True,
        "language": str(getattr(result, "language", "") or language or "unknown"),
        "cues": cues,
    }


def _error_response(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {"id": request_id, "ok": False, "code": code, "message": message}


def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    request_id = str(request.get("id", "unknown"))
    if request.get("op") != "transcribe":
        return _error_response(request_id, "ASR_REQUEST_INVALID", "ASR worker request was invalid")
    required = ("audio_path", "model", "aligner")
    if any(not isinstance(request.get(key), str) or not request[key].strip() for key in required):
        return _error_response(request_id, "ASR_REQUEST_INVALID", "ASR worker request was invalid")
    try:
        return _transcribe(request)
    except Exception as error:  # The parent receives a stable error; details stay local.
        code = "ASR_MODEL_LOAD_FAILED" if _MODEL is None else "ASR_INFERENCE_FAILED"
        print(f"{code}: {type(error).__name__}", file=sys.stderr, flush=True)
        return _error_response(request_id, code, "ASR inference was unavailable")


def main() -> None:
    configure_utf8_streams()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
            response = handle_request(request)
        except Exception:
            response = _error_response("unknown", "ASR_REQUEST_INVALID", "ASR worker request was invalid")
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
