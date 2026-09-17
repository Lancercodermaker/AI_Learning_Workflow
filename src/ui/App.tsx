import { useMemo, useState } from 'react';
import type { LearningMaterialIR, KnowledgeSegment } from '../domain/ir';
import { ApiError, learningApi, type LearningApi } from './api';

export type AppProps = {
  initialMaterial?: LearningMaterialIR | null;
  api?: LearningApi;
};

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function segmentEvidence(material: LearningMaterialIR, segment: KnowledgeSegment) {
  const frameIds = new Set(segment.evidence_frame_refs);
  return material.evidence_frames.filter((frame) => frameIds.has(frame.id));
}

function segmentCues(material: LearningMaterialIR, segment: KnowledgeSegment) {
  const cueIds = new Set(segment.transcript_refs);
  return material.transcript.filter((cue) => cueIds.has(cue.id));
}

function sourceJump(material: LearningMaterialIR, segment: KnowledgeSegment): string {
  const cue = segmentCues(material, segment)[0];
  const seconds = Math.floor(cue?.start ?? segment.start);
  return `${material.material.source.url}?t=${seconds}`;
}

function isAnalysisFailure(material: LearningMaterialIR): boolean {
  return material.pipeline.status === 'partial' || material.pipeline.errors.some((error) => error.stage === 'analysis');
}

export function App({ initialMaterial = null, api = learningApi }: AppProps) {
  const [bvid, setBvid] = useState(initialMaterial?.material.source.bvid ?? '');
  const [material, setMaterial] = useState<LearningMaterialIR | null>(initialMaterial);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleSegments = useMemo(() => {
    if (!material || !selectedNode) return material?.segments ?? [];
    return material.segments.filter((segment) => segment.id === selectedNode);
  }, [material, selectedNode]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const queued = await api.createMaterial(bvid.trim());
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await wait(250);
        try {
          setMaterial(await api.getMaterial(queued.material_id));
          return;
        } catch (pollError: unknown) {
          if (!(pollError instanceof ApiError) || pollError.code !== 'NOT_FOUND') throw pollError;
        }
      }
      throw new Error('Material is still processing; refresh to check again.');
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Material request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    if (!material) return;
    setBusy(true);
    setError(null);
    try {
      setMaterial(await api.rerunAnalysis(material.material.id));
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Analysis retry failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI LEARNING WORKFLOW <span>v0.2</span></p>
          <h1>学习驾驶舱</h1>
        </div>
        <div className="topbar-status" aria-label="pipeline status">{busy ? 'PROCESSING' : material?.pipeline.status.toUpperCase() ?? 'READY'}</div>
      </header>

      <main className="page-content">
        <section className="intake-panel" aria-labelledby="intake-title">
          <div>
            <p className="eyebrow">SOURCE INGEST</p>
            <h2 id="intake-title">把一个视频变成可回看的知识地图</h2>
            <p className="muted">先固定原文与证据，再生成解释。没有字幕或截图时，界面会明确显示缺口。</p>
          </div>
          <form className="bvid-form" onSubmit={handleCreate}>
            <label htmlFor="bvid">BVID</label>
            <div className="form-row">
              <input id="bvid" value={bvid} onChange={(event) => setBvid(event.target.value)} placeholder="BV1..." pattern="BV[0-9A-Za-z]+" required />
              <button type="submit" disabled={busy}>Load material</button>
            </div>
          </form>
          {error && <p className="error-banner" role="alert">{error}</p>}
        </section>

        {!material && (
          <section className="empty-state" aria-label="no material loaded">
            <span className="empty-number">01</span>
            <div><h2>等待一个学习材料</h2><p className="muted">输入 BVID 后，这里会按 Profile → Map → Groundtruth 的顺序展开。</p></div>
          </section>
        )}

        {material && (
          <>
            <section className="profile-section" aria-labelledby="profile-title">
              <div className="section-heading"><p className="eyebrow">01 / MATERIAL</p><h2 id="profile-title">Material Profile</h2></div>
              <div className="profile-grid">
                <div className="profile-main"><p className="material-kicker">{material.material.source.bvid}</p><h3>{material.material.metadata.title}</h3><p className="muted">{material.material.metadata.description ?? 'No source description supplied.'}</p></div>
                <dl className="metadata-strip">
                  <div><dt>Uploader</dt><dd>{material.material.metadata.uploader ?? '—'}</dd></div>
                  <div><dt>Duration</dt><dd>{material.material.metadata.duration_seconds ? `${Math.round(material.material.metadata.duration_seconds / 60)} min` : '—'}</dd></div>
                  <div><dt>Chapters</dt><dd>{material.material.metadata.chapters?.length ?? 0}</dd></div>
                  <div><dt>Transcript</dt><dd>{material.transcript.length ? `${material.transcript.length} cues` : 'Unavailable'}</dd></div>
                </dl>
              </div>
            </section>

            <section className="map-section" aria-labelledby="map-title">
              <div className="section-heading"><p className="eyebrow">02 / STRUCTURE</p><h2 id="map-title">Knowledge Map</h2></div>
              <div className="map-layout">
                <nav className="node-list" aria-label="Knowledge Map nodes">
                  <button className={selectedNode === null ? 'node-button active' : 'node-button'} onClick={() => setSelectedNode(null)} aria-pressed={selectedNode === null}>All segments <span>{material.segments.length}</span></button>
                  {material.segments.map((segment) => <button key={segment.id} className={selectedNode === segment.id ? 'node-button active' : 'node-button'} onClick={() => setSelectedNode(segment.id)} aria-pressed={selectedNode === segment.id}><span>{segment.id}</span>{segment.topic}<span>→</span></button>)}
                </nav>
                <div className="map-canvas" aria-label="knowledge map overview">
                  <div className="map-grid-lines" />
                  {material.segments.length ? material.segments.map((segment, index) => <button key={segment.id} className={selectedNode === segment.id ? 'map-node selected' : 'map-node'} style={{ '--node-index': index } as React.CSSProperties} onClick={() => setSelectedNode(segment.id)}>{segment.topic}<small>{segment.start.toFixed(0)}–{segment.end.toFixed(0)}s</small></button>) : <p className="map-empty">No transcript-derived segments yet.</p>}
                </div>
              </div>
              <p className="showing-count">showing {visibleSegments.length} / {material.segments.length}</p>
            </section>

            <section className="timeline-section" aria-labelledby="timeline-title">
              <div className="section-heading timeline-heading"><div><p className="eyebrow">03 / EVIDENCE</p><h2 id="timeline-title">Groundtruth Timeline</h2></div>{isAnalysisFailure(material) && <div className="analysis-warning"><strong>AI analysis failed</strong><button type="button" onClick={handleRetry} disabled={busy}>Retry analysis</button></div>}</div>
              {visibleSegments.length ? <div className="timeline-list">{visibleSegments.map((segment) => {
                const frames = segmentEvidence(material, segment);
                const cues = segmentCues(material, segment);
                const claims = segment.claims;
                return <article className="timeline-card" key={segment.id}>
                  <div className="timeline-marker"><span>{segment.id}</span><i /></div>
                  <div className="timeline-card-content"><div className="card-topline"><span>{segment.start.toFixed(1)}s — {segment.end.toFixed(1)}s</span><span>{frames.length ? `${frames.length} evidence frame${frames.length > 1 ? 's' : ''}` : 'evidence unavailable'}</span></div>
                    <h3>{segment.topic}</h3>
                    <div className="evidence-layout">{frames.length ? <div className="frame-stack">{frames.map((frame) => <figure key={frame.id}><img src={`/media/${encodeURIComponent(material.material.id)}/${encodeURIComponent(frame.path)}`} alt={`${segment.topic} evidence at ${frame.timestamp.toFixed(1)} seconds`} /><figcaption>{frame.reason}</figcaption></figure>)}</div> : <div className="frame-unavailable">No source frame available for this segment.</div>}
                      <div className="claim-stack"><p className="summary">{segment.summary ?? (material.analysis?.summary ?? 'No AI summary available yet.')}</p>{claims.length ? <div className="provenance-list">{claims.map((claim) => <div className={`provenance ${claim.type.toLowerCase()}`} key={claim.id}><span>{claim.type}</span><p>{claim.claim}</p></div>)}</div> : <p className="muted">No grounded claims yet.</p>}</div>
                    </div>
                    <div className="card-footer"><span>Transcript evidence: {cues.length ? cues.map((cue) => `${cue.start.toFixed(1)}s`).join(', ') : 'unavailable'}</span><a href={sourceJump(material, segment)} target="_blank" rel="noreferrer">Jump to source ↗</a></div>
                  </div>
                </article>;
              })}</div> : <div className="empty-state compact"><span className="empty-number">—</span><div><h3>Timeline waiting for transcript evidence</h3><p className="muted">This material has no public timestamped subtitle track. No evidence imagery has been invented.</p></div></div>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
