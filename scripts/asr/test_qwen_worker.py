import unittest

from scripts.asr.qwen_worker import normalize_cues, resolve_device


class QwenWorkerUnitTests(unittest.TestCase):
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
