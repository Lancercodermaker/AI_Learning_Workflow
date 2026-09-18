import type { LearningMaterialIR } from '../domain/ir';

export type ApiErrorShape = { error: { code: string; message: string; stage: string } };

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly stage: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json() as T | ApiErrorShape;
  if (!response.ok) {
    const error = body as ApiErrorShape;
    throw new ApiError(response.status, error.error?.code ?? 'HTTP_ERROR', error.error?.message ?? 'Request failed', error.error?.stage ?? 'render');
  }
  return body as T;
}

export type LearningApi = {
  createMaterial(bvid: string): Promise<{ material_id: string; status: 'queued' }>;
  getMaterial(materialId: string): Promise<LearningMaterialIR>;
  rerunAnalysis(materialId: string): Promise<LearningMaterialIR>;
};

export const learningApi: LearningApi = {
  createMaterial: (bvid) => requestJson('/api/materials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bvid }),
  }),
  getMaterial: (materialId) => requestJson(`/api/materials/${encodeURIComponent(materialId)}`),
  rerunAnalysis: (materialId) => requestJson(`/api/materials/${encodeURIComponent(materialId)}/analyze`, { method: 'POST' }),
};
