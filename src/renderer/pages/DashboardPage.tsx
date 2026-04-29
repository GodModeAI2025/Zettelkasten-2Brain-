import { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useIngestStore } from '../stores/ingest.store';
import { useWikiStore } from '../stores/wiki.store';
import { IngestProgress } from '../components/ingest/IngestProgress';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/bridge';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import type { WikiReviewItem, WikiReviewReason } from '../../shared/api.types';

interface ProjectConfig {
  name: string;
  domain: string;
  language: string;
  models: { ingest: string; query: string; lint: string };
  ingest: { tags: string[]; entityTypes: string[]; conceptTypes: string[] };
  output: { format: string };
}

const REVIEW_REASON_LABELS: Record<WikiReviewReason, string> = {
  unreviewed: 'unreviewed',
  seed: 'seed',
  stale: 'stale',
  'low-confidence': 'low confidence',
  uncertain: 'uncertain',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { activeProject, activeStatus, refreshStatus } = useProjectStore();
  const addNotification = useAppStore((s) => s.addNotification);
  const setActivePage = useWikiStore((s) => s.setActivePage);
  const reviewItems = useWikiStore((s) => s.reviewQueue);
  const reviewLoading = useWikiStore((s) => s.reviewLoading);
  const refreshReviewQueue = useWikiStore((s) => s.refreshReviewQueue);
  const ingestPhase = useIngestStore((s) => s.phase);
  const ingestProgress = useIngestStore((s) => s.progress);
  const ingestSummaryMessage = useIngestStore((s) => s.summaryMessage);
  const ingestTotalFiles = useIngestStore((s) => s.totalFiles);
  const ingestProcessedFiles = useIngestStore((s) => s.processedFiles);
  const ingestStartedAt = useIngestStore((s) => s.startedAt);
  const ingestStart = useIngestStore((s) => s.start);
  const ingestReset = useIngestStore((s) => s.reset);

  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [cancellingIngest, setCancellingIngest] = useState(false);

  // Editable fields as strings for easier editing
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState('de');
  const [modelIngest, setModelIngest] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [modelLint, setModelLint] = useState('');
  const [entityTypes, setEntityTypes] = useState('');
  const [conceptTypes, setConceptTypes] = useState('');
  const [tags, setTags] = useState('');
  const [suggestingField, setSuggestingField] = useState<'entityTypes' | 'conceptTypes' | 'tags' | null>(null);

  const loadConfig = useCallback(async () => {
    if (!activeProject) return;
    try {
      const cfg = await api.project.getConfig(activeProject) as unknown as ProjectConfig;
      setConfig(cfg);
      setDomain(cfg.domain || '');
      setLanguage(cfg.language || 'de');
      setModelIngest(cfg.models?.ingest || '');
      setModelQuery(cfg.models?.query || '');
      setModelLint(cfg.models?.lint || '');
      setEntityTypes(cfg.ingest?.entityTypes?.join(', ') || '');
      setConceptTypes(cfg.ingest?.conceptTypes?.join(', ') || '');
      setTags(cfg.ingest?.tags?.join(', ') || '');
      setConfigDirty(false);
    } catch {
      // Config nicht lesbar
    }
  }, [activeProject]);

  useEffect(() => {
    refreshStatus();
    loadConfig();
    refreshReviewQueue();
  }, [activeProject, loadConfig, refreshReviewQueue]);

  useEffect(() => {
    if (ingestPhase !== 'running' && ingestPhase !== 'committing') {
      setCancellingIngest(false);
    }
  }, [ingestPhase]);

  const cancelIngest = async () => {
    if (!activeProject || cancellingIngest) return;
    setCancellingIngest(true);
    try {
      const res = await api.ingest.cancel(activeProject);
      if (!res.cancelled) {
        addNotification('info', 'Kein laufender Ingest gefunden.');
        setCancellingIngest(false);
      }
    } catch (err) {
      addNotification('error', `Abbruch fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      setCancellingIngest(false);
    }
  };

  const markDirty = () => setConfigDirty(true);

  const saveConfig = async () => {
    if (!activeProject) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        domain,
        language,
        models: { ingest: modelIngest, query: modelQuery, lint: modelLint },
        ingest: {
          tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
          entityTypes: entityTypes.split(',').map((s) => s.trim()).filter(Boolean),
          conceptTypes: conceptTypes.split(',').map((s) => s.trim()).filter(Boolean),
        },
      };
      await api.project.setConfig(activeProject, patch);
      setConfigDirty(false);
      addNotification('success', 'Projekt-Konfiguration gespeichert.');
      await loadConfig();
    } catch (err) {
      addNotification('error', `Konfiguration speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const suggestTaxonomy = async (field: 'entityTypes' | 'conceptTypes' | 'tags') => {
    if (!activeProject) return;
    setSuggestingField(field);
    try {
      const { suggestions, reasoning } = await api.project.suggestTaxonomy(activeProject, field);
      if (suggestions.length === 0) {
        addNotification('info', 'Keine Vorschlaege ableitbar.');
        return;
      }
      const joined = suggestions.join(', ');
      if (field === 'entityTypes') setEntityTypes(joined);
      else if (field === 'conceptTypes') setConceptTypes(joined);
      else setTags(joined);
      markDirty();
      addNotification('success', `Vorschlag uebernommen${reasoning ? ': ' + reasoning : ''}. Speichern nicht vergessen.`);
    } catch (err) {
      addNotification('error', `Vorschlag fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSuggestingField(null);
    }
  };

  const handleRebuild = async () => {
    if (!activeProject) return;
    setConfirmRebuild(false);
    setRebuilding(true);
    try {
      // Alle Dateien neu ingesten (files=undefined -> alle neuen + bereits verarbeitete)
      const allRaw = await api.files.listRaw(activeProject);
      if (allRaw.length === 0) {
        addNotification('info', 'Keine Rohdaten vorhanden — nichts zum Neu-Aufbauen.');
        return;
      }
      ingestStart(allRaw.length);
      await api.ingest.run(activeProject, allRaw);
      addNotification('success', 'Wiki wurde neu aufgebaut.');
      await refreshStatus();
      await refreshReviewQueue();
    } catch (err) {
      addNotification('error', `Wiki-Neuaufbau fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRebuilding(false);
    }
  };

  const openReviewItem = (item: WikiReviewItem) => {
    setActivePage(item.path);
    navigate('/wiki');
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Kein Projekt ausgewaehlt.</p>
        </div>
      </div>
    );
  }

  if (!activeStatus) {
    return (
      <div>
        <div className="page-header">
          <h1>{activeProject}</h1>
          <p>Lade Status...</p>
        </div>
      </div>
    );
  }

  const s = activeStatus;

  const showRebuildProgress = rebuilding || ingestPhase !== 'idle';

  return (
    <div>
      <div className="page-header">
        <h1>{activeProject}</h1>
        <p>Status-Übersicht</p>
      </div>

      {showRebuildProgress && ingestPhase !== 'idle' && (
        <div style={{ marginBottom: 16 }}>
          <IngestProgress
            entries={ingestProgress}
            phase={ingestPhase}
            totalFiles={ingestTotalFiles}
            processedFiles={ingestProcessedFiles}
            summaryMessage={ingestSummaryMessage}
            startedAt={ingestStartedAt}
            onCancel={cancelIngest}
            cancelling={cancellingIngest}
          />
          {!rebuilding && (ingestPhase === 'complete' || ingestPhase === 'cancelled') && (
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => ingestReset()}>
                Fortschritt ausblenden
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div className="card">
          <h3>Wiki-Seiten</h3>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{s.totalPages}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {s.sources} Quellen, {s.entities} Entitäten, {s.concepts} Konzepte, {s.synthesis} Synthesen, {s.sops} SOPs, {s.decisions} Entscheidungen
          </div>
        </div>

        <div className="card">
          <h3>Integrität</h3>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="dash-integrity-badge badge-success">{s.confirmed} bestätigt</span>
            <span className="dash-integrity-badge badge-warning">{s.seed} seed</span>
            <span className="dash-integrity-badge badge-error">{s.stale} veraltet</span>
            {s.unreviewed > 0 && <span className="dash-integrity-badge badge-warning">{s.unreviewed} unreviewed</span>}
          </div>
        </div>

        <div className="card">
          <h3>Rohdaten</h3>
          <div style={{ fontSize: 32, fontWeight: 700, color: s.rawNew > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {s.rawNew > 0 ? `${s.rawNew} neu` : 'Alle verarbeitet'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {s.rawTotal} gesamt
          </div>
        </div>

        <div className="card">
          <h3>Letzte Aktionen</h3>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <div>Ingest: {s.lastIngest || '\u2014'}</div>
            <div>Lint: {s.lastLint || '\u2014'}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <Link to="/raw" className="btn btn-primary">Datei hochladen</Link>
        <Link to="/ingest" className="btn btn-secondary">Ingest starten</Link>
        <Link to="/query" className="btn btn-secondary">Frage stellen</Link>
      </div>

      <div className="card dashboard-review-card">
        <div className="dashboard-review-header">
          <div>
            <h3>Review-Warteschlange</h3>
            <p>Seiten mit Review-Bedarf, Seed-Status oder niedriger Confidence.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={refreshReviewQueue} disabled={reviewLoading}>
            {reviewLoading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>

        {reviewLoading && reviewItems.length === 0 ? (
          <p className="dashboard-review-muted">Pruefe Wiki-Seiten...</p>
        ) : reviewItems.length === 0 ? (
          <p className="dashboard-review-muted">Alles ruhig: keine Seiten mit Review-Bedarf gefunden.</p>
        ) : (
          <div className="dashboard-review-list">
            {reviewItems.slice(0, 6).map((item) => (
              <button
                key={item.path}
                type="button"
                className="dashboard-review-item"
                onClick={() => openReviewItem(item)}
              >
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.path}</span>
                </div>
                <div className="dashboard-review-reasons">
                  {item.reasons.map((reason) => (
                    <em key={reason}>{REVIEW_REASON_LABELS[reason]}</em>
                  ))}
                </div>
              </button>
            ))}
            {reviewItems.length > 6 && (
              <div className="dashboard-review-more">
                +{reviewItems.length - 6} weitere Seiten
              </div>
            )}
          </div>
        )}
      </div>

      {/* === Projekt-Konfiguration === */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Projekt-Konfiguration</h3>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowConfigEditor(!showConfigEditor)}
          >
            {showConfigEditor ? 'Zuklappen' : 'Bearbeiten'}
          </button>
        </div>

        {!showConfigEditor && config && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            <span>Domain: <strong>{config.domain || '(keine)'}</strong></span>
            {' \u00B7 '}
            <span>Sprache: <strong>{config.language}</strong></span>
            {' \u00B7 '}
            <span>Modell: <strong>{config.models?.ingest}</strong></span>
          </div>
        )}

        {showConfigEditor && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <div className="input-group">
              <label>Themengebiet / Domain</label>
              <input
                type="text"
                placeholder="z.B. Erneuerbare Energien, Software-Architektur..."
                value={domain}
                onChange={(e) => { setDomain(e.target.value); markDirty(); }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Wird dem KI-Modell als Kontext mitgegeben
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="input-group">
                <label>Sprache</label>
                <select value={language} onChange={(e) => { setLanguage(e.target.value); markDirty(); }}>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Entitaets-Typen (kommagetrennt)</label>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => suggestTaxonomy('entityTypes')}
                  disabled={suggestingField !== null}
                  title="Per KI aus Rohdaten und Wiki vorschlagen"
                >
                  {suggestingField === 'entityTypes' ? 'Schlaegt vor...' : '✨ KI-Vorschlag'}
                </button>
              </div>
              <input
                type="text"
                placeholder="person, organization, product, tool"
                value={entityTypes}
                onChange={(e) => { setEntityTypes(e.target.value); markDirty(); }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Bestimmt welche Entitäten beim Ingest extrahiert werden
              </span>
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Konzept-Typen (kommagetrennt)</label>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => suggestTaxonomy('conceptTypes')}
                  disabled={suggestingField !== null}
                  title="Per KI aus Rohdaten und Wiki vorschlagen"
                >
                  {suggestingField === 'conceptTypes' ? 'Schlaegt vor...' : '✨ KI-Vorschlag'}
                </button>
              </div>
              <input
                type="text"
                placeholder="technique, framework, theory, pattern"
                value={conceptTypes}
                onChange={(e) => { setConceptTypes(e.target.value); markDirty(); }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Bestimmt welche Konzepte beim Ingest extrahiert werden
              </span>
            </div>

            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Tags (kommagetrennt)</label>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => suggestTaxonomy('tags')}
                  disabled={suggestingField !== null}
                  title="Per KI aus Rohdaten und Wiki vorschlagen"
                >
                  {suggestingField === 'tags' ? 'Schlaegt vor...' : '✨ KI-Vorschlag'}
                </button>
              </div>
              <input
                type="text"
                placeholder="optional: wind, solar, offshore..."
                value={tags}
                onChange={(e) => { setTags(e.target.value); markDirty(); }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div className="input-group">
                <label>Modell (Ingest)</label>
                <input
                  type="text"
                  value={modelIngest}
                  onChange={(e) => { setModelIngest(e.target.value); markDirty(); }}
                />
              </div>
              <div className="input-group">
                <label>Modell (Query)</label>
                <input
                  type="text"
                  value={modelQuery}
                  onChange={(e) => { setModelQuery(e.target.value); markDirty(); }}
                />
              </div>
              <div className="input-group">
                <label>Modell (Lint)</label>
                <input
                  type="text"
                  value={modelLint}
                  onChange={(e) => { setModelLint(e.target.value); markDirty(); }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={saveConfig}
                disabled={saving || !configDirty}
              >
                {saving ? 'Speichere...' : 'Konfiguration speichern'}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => setConfirmRebuild(true)}
                disabled={rebuilding}
              >
                {rebuilding ? 'Baut auf...' : 'Wiki neu aufbauen'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Alle Rohdaten werden mit den aktuellen Parametern neu ingestet
              </span>
            </div>
          </div>
        )}
      </div>

      {confirmRebuild && (
        <ConfirmDialog
          title="Wiki neu aufbauen"
          message={`Alle ${s.rawTotal} Rohdatei(en) werden mit den aktuellen Parametern neu ingestet. Das bestehende Wiki wird dabei ergänzt/überschrieben. Das kann je nach Datenmenge mehrere Minuten dauern und API-Kosten verursachen. Fortfahren?`}
          confirmLabel="Wiki neu aufbauen"
          danger
          onConfirm={handleRebuild}
          onCancel={() => setConfirmRebuild(false)}
        />
      )}
    </div>
  );
}
