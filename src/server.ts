import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHttpHandler } from './app/http';
import { loadProviderConfig } from './app/config';
import { MaterialStore } from './domain/material-store';
import { PipelineError } from './domain/errors';
import { createGateway } from './llm/gateway';
import { runPipeline, type PipelineDependencies } from './pipeline/run-pipeline';
import { createBilibiliClient } from './video/bilibili/client';
import { segmentTranscript } from './video/segmentation/segment';

export function createLearningServer(rootDir = process.cwd()): Server {
  const store = new MaterialStore(rootDir);
  const bilibili = createBilibiliClient();
  const dependencies: PipelineDependencies = {
    store,
    ingest: (bvid) => bilibili.fetchMaterial(bvid),
    transcript: async (source) => source.subtitleTracks[0]?.cues ?? [],
    segmentation: async ({ transcript, chapters, visualBoundaries }) => segmentTranscript({ transcript, chapters, visualBoundaries }),
    evidence: async () => [],
    analysis: async ({ transcript, segments, evidenceFrames }) => {
      if (transcript.length === 0) {
        throw new PipelineError('analysis', 'NO_TRANSCRIPT', 'Timestamped transcript is required before AI analysis', false);
      }
      const gateway = createGateway(loadProviderConfig());
      const result = await gateway.analyze({
        segmentId: segments[0]?.id ?? 'V01',
        transcript: transcript.map(({ id, start, end, text, source }) => ({ id, start, end, text, source })),
        evidenceTimestamps: evidenceFrames.map((frame) => frame.timestamp),
      });
      return {
        ...result,
        claims: result.claims.map((claim, index) => ({ id: `a${String(index + 1).padStart(4, '0')}`, ...claim })),
      };
    },
  };
  return createServer(createHttpHandler({
    store,
    run: (input) => runPipeline({ ...input, dependencies }),
  }));
}

async function main(): Promise<void> {
  const port = Number(process.env.LEARNING_PORT ?? '4310');
  const server = createLearningServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  process.stdout.write(`AI Learning Workflow server listening on 127.0.0.1:${port}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'server failed'}\n`);
    process.exitCode = 1;
  });
}
