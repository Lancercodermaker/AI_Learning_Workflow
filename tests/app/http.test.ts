import { createServer, type Server } from 'node:http';
import { describe, expect, it, vi, afterEach } from 'vitest';
import fixture from '../fixtures/learning-material.json';
import { LearningMaterialSchema } from '../../src/domain/ir';
import { createHttpHandler, type HttpAppOptions } from '../../src/app/http';

const material = LearningMaterialSchema.parse(fixture);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(options: HttpAppOptions): Promise<string> {
  const server = createServer(createHttpHandler(options));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

function options(overrides: Partial<HttpAppOptions> = {}): HttpAppOptions {
  return {
    store: {
      readStage: vi.fn(async () => null),
      writeStage: vi.fn(async () => undefined),
      appendLog: vi.fn(async () => undefined),
      writeLearningMaterial: vi.fn(async () => undefined),
      readLearningMaterial: vi.fn(async () => material),
      getMaterialDir: vi.fn(() => 'C:/fixture-material'),
    },
    run: vi.fn(async () => ({ status: 'complete' as const, current_stage: 'render' as const, material })),
    ...overrides,
  };
}

describe('HTTP application', () => {
  it('queues a material and returns the material IR', async () => {
    const app = options();
    const baseUrl = await start(app);
    const queued = await fetch(`${baseUrl}/api/materials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bvid: 'BV1fixture' }),
    });
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ material_id: 'bilibili:BV1fixture', status: 'queued' });

    const fetched = await fetch(`${baseUrl}/api/materials/bilibili:BV1fixture`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).schema_version).toBe('0.2');
    expect(app.run).toHaveBeenCalledWith({ bvid: 'BV1fixture' });
  });

  it('rejects oversized or malformed request bodies without stack traces', async () => {
    const baseUrl = await start(options());
    const response = await fetch(`${baseUrl}/api/materials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bvid: 'BV1fixture', extra: 'x'.repeat(1200) }),
    });
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: 'BODY_TOO_LARGE', stage: 'ingest' });
    expect(JSON.stringify(body)).not.toContain('stack');
  });
});
