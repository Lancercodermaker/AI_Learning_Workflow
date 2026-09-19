import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/learning-material.json';
import { LearningMaterialSchema } from '../../src/domain/ir';
import { App } from '../../src/ui/App';

const material = LearningMaterialSchema.parse(fixture);

describe('map-first workbench', () => {
  it('renders profile, map, then groundtruth timeline with provenance and source jump', () => {
    const markup = renderToStaticMarkup(<App initialMaterial={material} />);
    expect(markup.indexOf('Material Profile')).toBeLessThan(markup.indexOf('Knowledge Map'));
    expect(markup.indexOf('Knowledge Map')).toBeLessThan(markup.indexOf('Groundtruth Timeline'));
    expect(markup).toContain('showing 1 / 1');
    expect(markup).toContain('SOURCE_CLAIM');
    expect(markup).toContain('https://www.bilibili.com/video/BV1fixture?t=0');
    expect(markup).toContain('left:12%;top:28%');
  });

  it('keeps evidence visible and exposes retry when analysis is partial', () => {
    const partial = structuredClone(material);
    partial.pipeline.status = 'partial';
    partial.pipeline.current_stage = 'analysis';
    partial.pipeline.errors = [{ stage: 'analysis', code: 'LLM_SCHEMA_INVALID', message: 'Pipeline stage analysis failed' }];
    const markup = renderToStaticMarkup(<App initialMaterial={partial} />);
    expect(markup).toContain('AI analysis failed');
    expect(markup).toContain('Retry analysis');
    expect(markup).toContain('Representative formula frame');
  });

  it('shows ASR transcript provenance', () => {
    const asrMaterial = structuredClone(material);
    asrMaterial.transcript[0]!.source = 'asr';
    const markup = renderToStaticMarkup(<App initialMaterial={asrMaterial} />);
    expect(markup).toContain('ASR');
  });

  it('shows a recoverable ASR error and retry action', () => {
    const failed = structuredClone(material);
    failed.transcript = [];
    failed.segments = [];
    failed.evidence_frames = [];
    failed.pipeline.status = 'failed';
    failed.pipeline.current_stage = 'transcript';
    failed.pipeline.errors = [{ stage: 'transcript', code: 'ASR_UNAVAILABLE', message: 'Pipeline stage transcript failed' }];
    const markup = renderToStaticMarkup(<App initialMaterial={failed} />);
    expect(markup).toContain('ASR unavailable');
    expect(markup).toContain('Retry analysis');
  });
});
