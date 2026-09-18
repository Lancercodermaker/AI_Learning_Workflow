import { readFile } from 'node:fs/promises';
import { extname, resolve, relative } from 'node:path';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { LearningMaterialIR } from '../domain/ir';
import type { PipelineStage } from '../domain/errors';
import type { PipelineResult } from '../pipeline/run-pipeline';

const MAX_BODY_BYTES = 1024;
const MaterialRequestSchema = z.object({ bvid: z.string().regex(/^BV[0-9A-Za-z]+$/) }).strict();

type HttpStore = {
  readStage(materialId: string, stage: string): Promise<unknown | null>;
  writeStage(materialId: string, stage: string, value: unknown): Promise<void>;
  appendLog(materialId: string, entry: { stage: PipelineStage; status: 'start' | 'pass' | 'fail'; message: string; at: string }): Promise<void>;
  writeLearningMaterial(material: LearningMaterialIR): Promise<void>;
  readLearningMaterial(materialId: string): Promise<LearningMaterialIR | null>;
  getMaterialDir(materialId: string): string;
};

export type HttpAppOptions = {
  store: HttpStore;
  run: (input: { bvid: string; forceStages?: PipelineStage[] }) => Promise<PipelineResult>;
};

type HttpFailure = { status: number; code: string; message: string; stage: PipelineStage };

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(payload));
  response.end(payload);
}

function sendError(response: ServerResponse, failure: HttpFailure): void {
  sendJson(response, failure.status, { error: { code: failure.code, message: failure.message, stage: failure.stage } });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function decodePathPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function bvidFromMaterialId(materialId: string): string | null {
  const match = materialId.match(/^bilibili:(BV[0-9A-Za-z]+)$/);
  return match?.[1] ?? null;
}

function safeMediaPath(store: HttpStore, materialId: string, filePath: string): string | null {
  if (!bvidFromMaterialId(materialId) || !filePath || filePath.includes('\0') || filePath.includes('\\')) return null;
  const root = resolve(store.getMaterialDir(materialId));
  const candidate = resolve(root, filePath);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes(':')) return null;
  return candidate;
}

function mediaContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: HttpAppOptions, jobs: Map<string, Promise<void>>): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (method === 'POST' && pathname === '/api/materials') {
    let body: unknown;
    try {
      body = JSON.parse(await readRequestBody(request));
    } catch (error: unknown) {
      const code = error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_JSON';
      sendError(response, { status: code === 'BODY_TOO_LARGE' ? 413 : 400, code, message: code === 'BODY_TOO_LARGE' ? 'Request body must be 1 KB or smaller' : 'Request body must be valid JSON', stage: 'ingest' });
      return;
    }
    const parsed = MaterialRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendError(response, { status: 400, code: 'INVALID_REQUEST', message: 'Request must contain a valid BVID', stage: 'ingest' });
      return;
    }
    const materialId = `bilibili:${parsed.data.bvid}`;
    if (jobs.has(materialId)) {
      sendError(response, { status: 409, code: 'ALREADY_RUNNING', message: 'Material processing is already running', stage: 'ingest' });
      return;
    }
    const job = options.run({ bvid: parsed.data.bvid }).then(() => undefined).catch(() => undefined).finally(() => { jobs.delete(materialId); });
    jobs.set(materialId, job);
    sendJson(response, 202, { material_id: materialId, status: 'queued' });
    return;
  }

  const materialMatch = pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (materialMatch && method === 'GET') {
    const materialId = decodePathPart(materialMatch[1] ?? '');
    if (!materialId || !bvidFromMaterialId(materialId)) {
      sendError(response, { status: 400, code: 'INVALID_MATERIAL_ID', message: 'Material ID is invalid', stage: 'ingest' });
      return;
    }
    const material = await options.store.readLearningMaterial(materialId);
    if (!material) {
      sendError(response, { status: 404, code: 'NOT_FOUND', message: 'Material was not found', stage: 'ingest' });
      return;
    }
    sendJson(response, 200, material);
    return;
  }

  if (materialMatch && method === 'POST') {
    const materialId = decodePathPart(materialMatch[1] ?? '');
    const bvid = materialId ? bvidFromMaterialId(materialId) : null;
    if (!materialId || !bvid) {
      sendError(response, { status: 400, code: 'INVALID_MATERIAL_ID', message: 'Material ID is invalid', stage: 'analysis' });
      return;
    }
    if (jobs.has(materialId)) {
      sendError(response, { status: 409, code: 'ALREADY_RUNNING', message: 'Material processing is already running', stage: 'analysis' });
      return;
    }
    if (!pathname.endsWith('/analyze')) {
      sendError(response, { status: 404, code: 'NOT_FOUND', message: 'Route was not found', stage: 'analysis' });
      return;
    }
    const result = await options.run({ bvid, forceStages: ['analysis'] });
    sendJson(response, 200, result.material);
    return;
  }

  const analyzeMatch = pathname.match(/^\/api\/materials\/([^/]+)\/analyze$/);
  if (analyzeMatch && method === 'POST') {
    const materialId = decodePathPart(analyzeMatch[1] ?? '');
    const bvid = materialId ? bvidFromMaterialId(materialId) : null;
    if (!materialId || !bvid) {
      sendError(response, { status: 400, code: 'INVALID_MATERIAL_ID', message: 'Material ID is invalid', stage: 'analysis' });
      return;
    }
    if (jobs.has(materialId)) {
      sendError(response, { status: 409, code: 'ALREADY_RUNNING', message: 'Material processing is already running', stage: 'analysis' });
      return;
    }
    const result = await options.run({ bvid, forceStages: ['analysis'] });
    sendJson(response, 200, result.material);
    return;
  }

  const mediaMatch = pathname.match(/^\/media\/([^/]+)\/(.+)$/);
  if (mediaMatch && method === 'GET') {
    const materialId = decodePathPart(mediaMatch[1] ?? '');
    const filePath = decodePathPart(mediaMatch[2] ?? '');
    if (!materialId || !filePath) {
      sendError(response, { status: 400, code: 'INVALID_MEDIA_PATH', message: 'Media path is invalid', stage: 'frames' });
      return;
    }
    const safePath = safeMediaPath(options.store, materialId, filePath);
    if (!safePath) {
      sendError(response, { status: 400, code: 'INVALID_MEDIA_PATH', message: 'Media path is invalid', stage: 'frames' });
      return;
    }
    try {
      const file = await readFile(safePath);
      response.statusCode = 200;
      response.setHeader('Content-Type', mediaContentType(safePath));
      response.end(file);
    } catch {
      sendError(response, { status: 404, code: 'NOT_FOUND', message: 'Media file was not found', stage: 'frames' });
    }
    return;
  }

  sendError(response, { status: 404, code: 'NOT_FOUND', message: 'Route was not found', stage: 'render' });
}

export function createHttpHandler(options: HttpAppOptions): RequestListener {
  const jobs = new Map<string, Promise<void>>();
  return (request, response) => {
    void handleRequest(request, response, options, jobs).catch(() => {
      if (!response.headersSent) sendError(response, { status: 500, code: 'INTERNAL_ERROR', message: 'Request could not be completed', stage: 'render' });
    });
  };
}
