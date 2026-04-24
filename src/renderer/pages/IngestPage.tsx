import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useIngestStore, type IngestSummary } from '../stores/ingest.store';
import { IngestProgress } from '../components/ingest/IngestProgress';
import { TakeawayList } from '../components/ingest/TakeawayList';
import { useWikiStore } from '../stores/wiki.store';
import type { PendingStub } from '../../shared/api.types';

export function IngestPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const refreshStatus = useProjectStore((s) => s.refreshStatus);
  const refreshWikiPages = useWikiStore((s) => s.refreshPages);
  const addNotification = useAppStore((s) => s.addNotification);

  const phase = useIngestStore((s) => s.phase);
  const progress = useIngestStore((s) => s.progress);
  const results = useIngestStore((s) => s.results);
  const summaryMessage = useIngestStore((s) => s.summaryMessage);
  const totalFiles = useIngestStore((s) => s.totalFiles);
  const processedFiles = useIngestStore((s) => s.processedFiles);
  const startedAt = useIngestStore((s) => s.startedAt);
  const start = useIngestStore((s) => s.start);
  const setResults = useIngestStore((s) => s.setResults);
  const reset = useIngestStore((s) => s.reset);

  const [rawFiles, setRawFiles] = useState<string[]>([]);
  const [totalRawCount, setTotalRawCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [pendingStubs, setPendingStubs] = useState<PendingStub[]>([]);
  const [cancelling, setCancelling] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!activeProject) return;
    try {
      const [allFiles, stubs] = await Promise.all([
        api.files.listRawWithStatus(activeProject),
        api.wiki.listPendingStubs(activeProject),
      ]);
      setTotalRawCount(allFiles.length);
      setRawFiles(allFiles.filter((f) => !f.ingested).map((f) => f.name));
      setPendingStubs(stubs);
    } catch {
      addNotification('error', 'Dateien konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeProject, addNotification]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (phase !== 'running' && phase !== 'committing') {
      setCancelling(false);
    }
  }, [phase]);

  const toggleFile = (file: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === rawFiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rawFiles));
    }
  };

  const deleteStub = async (slug: string) => {
    if (!activeProject) return;
    try {
      await api.wiki.deletePendingStub(activeProject, slug);
      setPendingStubs((prev) => prev.filter((s) => s.slug !== slug));
    } catch {
      addNotification('error', 'Stub konnte nicht entfernt werden.');
    }
  };

  const runIngest = async () => {
    if (!activeProject) return;
    const files = selected.size > 0 ? [...selected] : undefined;
    start(files?.length || rawFiles.length);
    setCancelling(false);

    try {
      const res = await api.ingest.run(activeProject, files);
      setResults(res as IngestSummary[]);
      await Promise.all([refreshStatus(), refreshWikiPages()]);
    } catch (err) {
      addNotification(
        'error',
        `Ingest fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCancelling(false);
    }
  };

  const cancelIngest = async () => {
    if (!activeProject || cancelling) return;
    setCancelling(true);
    try {
      const res = await api.ingest.cancel(activeProject);
      if (!res.cancelled) {
        addNotification('info', 'Kein laufender Ingest gefunden.');
        setCancelling(false);
      }
    } catch (err) {
      addNotification(
        'error',
        `Abbruch fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
      setCancelling(false);
    }
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Ingest</h1>
          <p>Kein Projekt ausgewählt.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Ingest</h1>
        <p>
          Rohdaten ins Wiki übernehmen
          {!loading && totalRawCount > 0 && (
            <> &mdash; {rawFiles.length} von {totalRawCount} Datei(en) noch nicht verarbeitet</>
          )}
        </p>
      </div>

      {/* Dateiauswahl — nur sichtbar wenn idle */}
      {phase === 'idle' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3>Dateien auswählen</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={selectAll}>
                {selected.size === rawFiles.length ? 'Keine' : 'Alle'}
              </button>
              <button
                className="btn btn-primary"
                onClick={runIngest}
                disabled={loading}
              >
                {selected.size > 0
                  ? `${selected.size} Datei(en) verarbeiten`
                  : 'Alle neuen verarbeiten'}
              </button>
            </div>
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Lade Dateien...</p>
          ) : rawFiles.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {totalRawCount > 0
                ? 'Alle Dateien wurden bereits verarbeitet. Um eine Datei erneut zu verarbeiten, nutze "Vergessen" unter Rohdaten.'
                : 'Keine Rohdaten vorhanden. Lade zuerst Dateien unter "Rohdaten" hoch.'}
            </p>
          ) : (
            <div className="ingest-file-list">
              {rawFiles.map((file) => (
                <label key={file} className="ingest-file-item">
                  <input
                    type="checkbox"
                    checked={selected.has(file)}
                    onChange={() => toggleFile(file)}
                  />
                  <span>{file}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Stubs — fehlende Seiten die beim naechsten Ingest befuellt werden */}
      {phase === 'idle' && pendingStubs.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--system-orange, #FF9500)' }}>
          <h3 style={{ marginBottom: 8 }}>Fehlende Seiten ({pendingStubs.length})</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Der Gesundheitscheck hat diese Seiten als fehlend erkannt. Beim naechsten Ingest wird versucht, sie mit Inhalt zu fuellen. Eintraege die du nicht brauchst, kannst du entfernen.
          </p>
          <div className="ingest-file-list">
            {pendingStubs.map((stub) => (
              <div key={stub.slug} className="ingest-file-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{stub.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>{stub.category}/</span>
                  {stub.referencedBy.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Referenziert von: {stub.referencedBy.join(', ')}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => deleteStub(stub.slug)}
                  title="Diesen Stub entfernen — Seite wird nicht befuellt"
                  style={{ flexShrink: 0, marginLeft: 8 }}
                >
                  Entfernen
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fortschritt + Status */}
      {phase !== 'idle' && (
        <IngestProgress
          entries={progress}
          phase={phase}
          totalFiles={totalFiles}
          processedFiles={processedFiles}
          summaryMessage={summaryMessage}
          startedAt={startedAt}
          onCancel={cancelIngest}
          cancelling={cancelling}
        />
      )}

      {/* Ergebnisse */}
      {(phase === 'complete' || phase === 'cancelled') && results.length > 0 && (
        <>
          <TakeawayList results={results} />
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => { reset(); loadFiles(); }}>
              Neuen Ingest starten
            </button>
          </div>
        </>
      )}

      {/* Abschluss ohne Ergebnisse */}
      {(phase === 'complete' || phase === 'cancelled') && results.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => { reset(); loadFiles(); }}>
            Zurück zur Dateiauswahl
          </button>
        </div>
      )}
    </div>
  );
}
