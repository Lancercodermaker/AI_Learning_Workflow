import { describe, expect, it } from 'vitest';
import { PipelineError } from '../../src/domain/errors';
import { parseAsrWorkerLine } from '../../src/video/asr/protocol';

describe('ASR worker protocol', () => {
  it('parses a successful response with timestamped cues', () => {
    const response = parseAsrWorkerLine(JSON.stringify({
      id: 'job-1',
      ok: true,
      language: 'Chinese',
      cues: [{ start: 0, end: 1.5, text: '第一句', source: 'asr' }],
    }), 'job-1');

    expect(response).toEqual({
      id: 'job-1',
      ok: true,
      language: 'Chinese',
      cues: [{ start: 0, end: 1.5, text: '第一句', source: 'asr' }],
    });
  });

  it('parses a sanitized worker error', () => {
    expect(parseAsrWorkerLine(JSON.stringify({
      id: 'job-2',
      ok: false,
      code: 'ASR_INFERENCE_FAILED',
      message: 'ASR inference failed',
    }), 'job-2')).toEqual({
      id: 'job-2',
      ok: false,
      code: 'ASR_INFERENCE_FAILED',
      message: 'ASR inference failed',
    });
  });

  it('rejects malformed JSON without exposing raw output', () => {
    expect(() => parseAsrWorkerLine('not-json-with-a-secret', 'job-3')).toThrowError(PipelineError);
    try {
      parseAsrWorkerLine('not-json-with-a-secret', 'job-3');
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineError);
      expect(String(error)).not.toContain('not-json-with-a-secret');
    }
  });

  it('rejects a response for another request id', () => {
    expect(() => parseAsrWorkerLine(JSON.stringify({
      id: 'other-job',
      ok: true,
      language: 'Chinese',
      cues: [],
    }), 'job-4')).toThrowError(PipelineError);
  });
});
