import { PipelineError } from '../domain/errors';
import type { ProviderConfig, ProviderName } from '../llm/gateway';

export type AsrConfig =
  | { enabled: false }
  | {
      enabled: true;
      python: string;
      model: string;
      aligner: string;
      language: string;
      device: 'auto' | 'cpu' | 'cuda:0';
      timeoutMs: number;
    };

export function loadProviderConfig(environment: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = environment.AI_PROVIDER as ProviderName | undefined;
  const allowedProviders: ProviderName[] = ['opencode', 'commandcode', 'deepseek'];
  if (!provider || !allowedProviders.includes(provider)) {
    throw new PipelineError('analysis', 'CONFIG_INVALID', 'AI_PROVIDER must name a supported provider', false);
  }
  const baseUrl = environment.AI_BASE_URL?.trim();
  const apiKey = environment.AI_API_KEY?.trim();
  const model = environment.AI_MODEL?.trim();
  const timeoutMs = Number(environment.AI_TIMEOUT_MS ?? '30000');
  if (!baseUrl || !apiKey || !model) {
    throw new PipelineError('analysis', 'CONFIG_MISSING', 'AI provider configuration is incomplete', false);
  }
  try {
    new URL(baseUrl);
  } catch (error: unknown) {
    throw new PipelineError('analysis', 'CONFIG_INVALID', 'AI_BASE_URL must be a valid URL', false, error);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PipelineError('analysis', 'CONFIG_INVALID', 'AI_TIMEOUT_MS must be positive', false);
  }
  return { provider, baseUrl, apiKey, model, timeoutMs };
}

export function loadAsrConfig(environment: NodeJS.ProcessEnv = process.env): AsrConfig {
  const enabledValue = environment.ASR_ENABLED?.trim().toLowerCase() ?? 'false';
  if (enabledValue === 'false' || enabledValue === '') return { enabled: false };
  if (enabledValue !== 'true') throw new PipelineError('transcript', 'ASR_CONFIG_INVALID', 'ASR_ENABLED must be true or false', false);

  const python = environment.ASR_PYTHON?.trim();
  if (!python) throw new PipelineError('transcript', 'ASR_CONFIG_MISSING', 'ASR_PYTHON is required when ASR is enabled', false);
  const model = environment.ASR_MODEL?.trim() || 'Qwen/Qwen3-ASR-0.6B';
  const aligner = environment.ASR_ALIGNER?.trim() || 'Qwen/Qwen3-ForcedAligner-0.6B';
  const language = environment.ASR_LANGUAGE?.trim() || 'Chinese';
  const deviceValue = environment.ASR_DEVICE?.trim() || 'auto';
  if (deviceValue !== 'auto' && deviceValue !== 'cpu' && deviceValue !== 'cuda:0') {
    throw new PipelineError('transcript', 'ASR_CONFIG_INVALID', 'ASR_DEVICE must be auto, cpu, or cuda:0', false);
  }
  const timeoutMs = Number(environment.ASR_TIMEOUT_MS ?? '1800000');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PipelineError('transcript', 'ASR_CONFIG_INVALID', 'ASR_TIMEOUT_MS must be positive', false);
  }
  return { enabled: true, python, model, aligner, language, device: deviceValue, timeoutMs };
}
