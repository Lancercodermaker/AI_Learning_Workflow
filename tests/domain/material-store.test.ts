import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MaterialStore } from '../../src/domain/material-store';
import { LearningMaterialSchema } from '../../src/domain/ir';
import fixture from '../fixtures/learning-material.json';

describe('MaterialStore', () => {
  it('round-trips a material and stage files under data/materials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'learning-store-test-'));
    try {
      const store = new MaterialStore(root);
      const material = LearningMaterialSchema.parse(fixture);
      await store.writeLearningMaterial(material);
      await store.writeStage('material-1', 'transcript', { cues: 2 });

      expect(await store.readLearningMaterial('material-1')).toEqual(material);
      expect(await store.readStage('material-1', 'transcript')).toEqual({ cues: 2 });
      expect(store.getMaterialDir('material-1')).toBe(join(root, 'data', 'materials', 'material-1'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal and path separator material IDs', async () => {
    const store = new MaterialStore('C:/learning-store-test');
    expect(() => store.getMaterialDir('../outside')).toThrow(/material ID/);
    expect(() => store.getMaterialDir('nested/material')).toThrow(/material ID/);
  });

  it('appends structured JSONL stage logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'learning-store-log-test-'));
    try {
      const store = new MaterialStore(root);
      await store.appendLog('material-1', { stage: 'ingest', status: 'start', message: 'started', at: '2026-01-01T00:00:00.000Z' });
      await store.appendLog('material-1', { stage: 'ingest', status: 'pass', message: 'done', at: '2026-01-01T00:00:01.000Z' });
      const log = await readFile(join(root, 'data', 'materials', 'material-1', 'pipeline.jsonl'), 'utf8');
      expect(log.trim().split('\n')).toHaveLength(2);
      expect(JSON.parse(log.trim().split('\n')[1]!)).toMatchObject({ status: 'pass' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
