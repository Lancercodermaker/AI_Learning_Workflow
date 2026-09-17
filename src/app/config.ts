import { PipelineError } from '../domain/errors';
import type { ProviderConfig, ProviderName } from '../llm/gateway';

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
