import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '../../src/domain/errors';
import { createGateway, type ProviderConfig, type SegmentAnalysisInput } from '../../src/llm/gateway';

const config: ProviderConfig = {
  provider: 'deepseek',
  baseUrl: 'https://provider.example.test',
  apiKey: 'secret-test-key',
  model: 'test-model',
  timeoutMs: 1000,
};

const input: SegmentAnalysisInput = {
  segmentId: 'V01',
  transcript: [{ id: 't0001', start: 0, end: 4, text: 'A random variable maps outcomes.', source: 'official' }],
  evidenceTimestamps: [2],
};

const responseWithContent = (content: string): Response => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content } }],
}), { status: 200 });

describe('provider-neutral analysis gateway', () => {
  it('normalizes a valid OpenAI-compatible response into grounded claims', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseWithContent(JSON.stringify({
      summary: 'The segment defines a random variable.',
      claims: [{
        claim: 'A random variable maps outcomes.',
        type: 'SOURCE_CLAIM',
        transcript_refs: ['t0001'],
        evidence_timestamps: [2],
      }],
    })));

    const result = await createGateway(config, { fetchImpl: fetchMock }).analyze(input);
    expect(result.summary).toContain('random variable');
    expect(result.claims[0]?.type).toBe('SOURCE_CLAIM');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://provider.example.test/chat/completions');
  });

  it('does exactly one repair request and then fails with a sanitized schema error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => responseWithContent('not-json'));
    await expect(createGateway(config, { fetchImpl: fetchMock }).analyze(input)).rejects.toMatchObject({
      stage: 'analysis',
      code: 'LLM_SCHEMA_INVALID',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(createGateway(config, { fetchImpl: fetchMock }).analyze(input)).rejects.not.toThrow(config.apiKey);
  });

  it('does not put the API key in a provider error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    try {
      await createGateway(config, { fetchImpl: fetchMock }).analyze(input);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PipelineError);
      expect(String(error)).not.toContain(config.apiKey);
      return;
    }
    throw new Error('expected gateway failure');
  });
});
