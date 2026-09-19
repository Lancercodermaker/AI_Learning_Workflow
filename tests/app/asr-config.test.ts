import { describe, expect, it } from 'vitest';
import { PipelineError } from '../../src/domain/errors';
import { loadAsrConfig } from '../../src/app/config';

const valid = {
  ASR_ENABLED: 'true',
  ASR_PYTHON: 'C:/Users/Fancy/anaconda3/envs/smartwatch-eating/python.exe',
  ASR_MODEL: 'Qwen/Qwen3-ASR-0.6B',
  ASR_ALIGNER: 'Qwen/Qwen3-ForcedAligner-0.6B',
  ASR_LANGUAGE: 'Chinese',
  ASR_DEVICE: 'auto',
  ASR_TIMEOUT_MS: '1800000',
};

describe('ASR configuration', () => {
  it('loads the configured local worker settings', () => {
    expect(loadAsrConfig(valid)).toEqual({
      enabled: true,
      python: valid.ASR_PYTHON,
      model: valid.ASR_MODEL,
      aligner: valid.ASR_ALIGNER,
      language: 'Chinese',
      device: 'auto',
      timeoutMs: 1800000,
    });
  });

  it('rejects enabled ASR without a Python executable', () => {
    expect(() => loadAsrConfig({ ...valid, ASR_PYTHON: '' })).toThrowError(PipelineError);
  });

  it('accepts disabled ASR without local model settings', () => {
    expect(loadAsrConfig({ ASR_ENABLED: 'false' })).toEqual({ enabled: false });
  });
});
