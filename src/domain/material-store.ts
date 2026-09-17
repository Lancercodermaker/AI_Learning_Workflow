import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LearningMaterialSchema, PipelineStageSchema, type LearningMaterialIR } from './ir';
import type { PipelineStage } from './errors';

type LogEntry = {
  stage: PipelineStage;
  status: 'start' | 'pass' | 'fail';
  message: string;
  at: string;
};

const stageFileName = (stage: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(stage)) throw new Error('invalid stage name');
  return `${stage}.json`;
};

const validateMaterialId = (materialId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(materialId) || materialId.includes('..')) {
    throw new Error('invalid material ID');
  }
  return materialId;
};

export class MaterialStore {
  constructor(private readonly rootDir: string) {}

  getMaterialDir(materialId: string): string {
    return join(this.rootDir, 'data', 'materials', validateMaterialId(materialId));
  }

  async readStage<T>(materialId: string, stage: string): Promise<T | null> {
    const filePath = join(this.getMaterialDir(materialId), stageFileName(stage));
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as T;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeStage<T>(materialId: string, stage: string, value: T): Promise<void> {
    const directory = this.getMaterialDir(materialId);
    await mkdir(directory, { recursive: true });
    const target = join(directory, stageFileName(stage));
    const temporary = join(directory, `.${stage}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async readLearningMaterial(materialId: string): Promise<LearningMaterialIR | null> {
    const value = await this.readStage<unknown>(materialId, 'material');
    return value === null ? null : LearningMaterialSchema.parse(value);
  }

  async writeLearningMaterial(material: LearningMaterialIR): Promise<void> {
    const parsed = LearningMaterialSchema.parse(material);
    await this.writeStage(parsed.material.id, 'material', parsed);
  }

  async appendLog(materialId: string, entry: LogEntry): Promise<void> {
    const parsed = {
      ...entry,
      stage: PipelineStageSchema.parse(entry.stage),
    };
    const directory = this.getMaterialDir(materialId);
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, 'pipeline.jsonl'), `${JSON.stringify(parsed)}\n`, 'utf8');
  }
}
