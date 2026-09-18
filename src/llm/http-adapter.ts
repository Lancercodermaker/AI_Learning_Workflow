import { PipelineError } from '../domain/errors';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type HttpAdapterConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  endpointPath?: string;
};

export type CompletionAdapter = {
  complete(messages: ChatMessage[]): Promise<string>;
};

export type HttpAdapterDependencies = { fetchImpl?: typeof fetch };

function endpointUrl(config: HttpAdapterConfig): string {
  const base = config.baseUrl.replace(/\/$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}${config.endpointPath ?? '/chat/completions'}`;
}

function extractContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
      .trim();
    return text || null;
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createHttpAdapter(config: HttpAdapterConfig, dependencies: HttpAdapterDependencies = {}): CompletionAdapter {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return {
    async complete(messages: ChatMessage[]): Promise<string> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetchImpl(endpointUrl(config), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages,
              temperature: 0,
              stream: false,
              response_format: { type: 'json_object' },
            }),
            signal: AbortSignal.timeout(config.timeoutMs),
          });
          if (!response.ok) {
            const retryable = isRetryableStatus(response.status);
            if (retryable && attempt === 0) continue;
            throw new PipelineError('analysis', `HTTP_${response.status}`, `LLM provider request failed with status ${response.status}`, retryable);
          }
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (error: unknown) {
            throw new PipelineError('analysis', 'LLM_RESPONSE_INVALID', 'LLM provider returned invalid JSON', false, error);
          }
          const content = extractContent(payload);
          if (!content) throw new PipelineError('analysis', 'LLM_RESPONSE_INVALID', 'LLM provider response had no text content', false);
          return content;
        } catch (error: unknown) {
          if (error instanceof PipelineError) {
            if (error.retryable && attempt === 0) continue;
            throw error;
          }
          if (attempt === 1) throw new PipelineError('analysis', 'LLM_NETWORK_ERROR', 'LLM provider request could not be completed', true, error);
        }
      }
      throw new PipelineError('analysis', 'LLM_REQUEST_FAILED', 'LLM provider request failed', true);
    },
  };
}
