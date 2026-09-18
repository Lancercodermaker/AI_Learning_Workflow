export type PipelineStage = 'ingest' | 'transcript' | 'segmentation' | 'frames' | 'evidence' | 'analysis' | 'render';

export class PipelineError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}
