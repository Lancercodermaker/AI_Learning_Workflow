import unittest
from unittest.mock import patch

from scripts.asr.qwen_worker import configure_utf8_streams, normalize_cues, resolve_device


class StreamRecorder:
    def __init__(self):
        self.encoding = "cp1252"
        self.errors = "strict"

    def reconfigure(self, *, encoding, errors):
        self.encoding = encoding
        self.errors = errors


class QwenWorkerUnitTests(unittest.TestCase):
    def test_configure_utf8_streams_supports_windows_unicode_output(self):
        stdin = StreamRecorder()
        stdout = StreamRecorder()
        stderr = StreamRecorder()

        with patch('scripts.asr.qwen_worker.sys.stdin', stdin), patch('scripts.asr.qwen_worker.sys.stdout', stdout), patch('scripts.asr.qwen_worker.sys.stderr', stderr):
            configure_utf8_streams()

        self.assertEqual((stdin.encoding, stdin.errors), ('utf-8', 'backslashreplace'))
        self.assertEqual((stdout.encoding, stdout.errors), ('utf-8', 'backslashreplace'))
        self.assertEqual((stderr.encoding, stderr.errors), ('utf-8', 'backslashreplace'))

    def test_normalize_cues_preserves_timestamp_ranges_and_source(self):
        cues = normalize_cues([
            {"start": 0.0, "end": 1.5, "text": "第一句"},
            {"start": 1.5, "end": 3.0, "text": "第二句"},
        ])

        self.assertEqual(cues, [
            {"start": 0.0, "end": 1.5, "text": "第一句", "source": "asr"},
            {"start": 1.5, "end": 3.0, "text": "第二句", "source": "asr"},
        ])

    def test_normalize_cues_skips_empty_or_invalid_ranges(self):
        cues = normalize_cues([
            {"start": 0.0, "end": 0.0, "text": "无效"},
            {"start": 1.0, "end": 2.0, "text": "  "},
            {"start": 2.0, "end": 4.0, "text": "有效"},
        ])

        self.assertEqual(cues, [{"start": 2.0, "end": 4.0, "text": "有效", "source": "asr"}])

    def test_resolve_device_prefers_cuda_only_when_available(self):
        self.assertEqual(resolve_device("cpu", cuda_available=True), "cpu")
        self.assertEqual(resolve_device("auto", cuda_available=True), "cuda:0")
        self.assertEqual(resolve_device("auto", cuda_available=False), "cpu")


if __name__ == "__main__":
    unittest.main()
