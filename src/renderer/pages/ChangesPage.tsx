import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/bridge';
import { useAppStore } from '../stores/app.store';
import type { GitChange, GitCommitInfo } from '../../shared/api.types';

interface GitStatus {
  clean: boolean;
  ahead: number;
  behind: number;
}

function stateLabel(state: GitChange['state']): string {
  switch (state) {
    case 'added': return 'Neu';
    case 'deleted': return 'Geloescht';
    case 'staged': return 'Vorgemerkt';
    case 'modified': return 'Geaendert';
    default: return 'Unveraendert';
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
      + ' '
      + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function shortOid(oid: string): string {
  return oid.slice(0, 7);
}

export function ChangesPage() {
  const addNotification = useAppStore((s) => s.addNotification);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextChanges, nextCommits] = await Promise.all([
        api.git.status(),
        api.git.listChanges(),
        api.git.listRecentCommits(10),
      ]);
      setStatus(nextStatus);
      setChanges(nextChanges);
      setCommits(nextCommits);
    } catch (err) {
      addNotification('error', `Git-Status konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
      setStatus(null);
      setChanges([]);
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    load();
  }, [load]);

  const groupedChanges = useMemo(() => {
    const groups = new Map<string, GitChange[]>();
    for (const change of changes) {
      const key = change.project || 'Repository';
      const list = groups.get(key) || [];
      list.push(change);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [changes]);

  const runGitAction = async (label: string, action: () => Promise<{ error?: string } | { success?: boolean; error?: string }>) => {
    setRunningAction(label);
    try {
      const result = await action();
      if ('error' in result && result.error) {
        addNotification('error', `${label} fehlgeschlagen: ${result.error}`);
      } else {
        addNotification('success', `${label} abgeschlossen.`);
      }
      await load();
    } catch (err) {
      addNotification('error', `${label} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div>
      <div className="page-header changes-header">
        <div>
          <h1>Aenderungen</h1>
          <p>Git-Status, lokale Dateien und letzte Commits</p>
        </div>
        <div className="changes-actions">
          <button className="btn btn-secondary" onClick={load} disabled={loading || !!runningAction}>
            Aktualisieren
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => runGitAction('Pull', api.git.pull)}
            disabled={loading || !!runningAction}
          >
            {runningAction === 'Pull' ? 'Pull...' : 'Pull'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => runGitAction('Push', api.git.push)}
            disabled={loading || !!runningAction}
          >
            {runningAction === 'Push' ? 'Push...' : 'Push'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => runGitAction('Sync', api.git.sync)}
            disabled={loading || !!runningAction}
          >
            {runningAction === 'Sync' ? 'Sync...' : 'Sync'}
          </button>
        </div>
      </div>

      <div className="changes-summary-grid">
        <div className="card changes-summary-card">
          <h3>Arbeitsstand</h3>
          <div className={`changes-status ${status?.clean ? 'clean' : 'dirty'}`}>
            {status?.clean ? 'Sauber' : changes.length > 0 ? `${changes.length} Datei(en)` : 'Unbekannt'}
          </div>
          <p>{status?.clean ? 'Keine lokalen Aenderungen.' : 'Lokale Aenderungen sind noch nicht synchronisiert.'}</p>
        </div>
        <div className="card changes-summary-card">
          <h3>Remote</h3>
          <div className="changes-status neutral">
            {status ? `${status.ahead} vor / ${status.behind} zurueck` : 'Unbekannt'}
          </div>
          <p>Der Wert ist eine schnelle Einschaetzung des lokalen Git-Stands.</p>
        </div>
      </div>

      <div className="changes-layout">
        <section className="card changes-panel">
          <div className="changes-panel-header">
            <h3>Lokale Aenderungen</h3>
            <span className="badge badge-neutral">{changes.length}</span>
          </div>
          {loading ? (
            <p className="changes-muted">Lade Aenderungen...</p>
          ) : groupedChanges.length === 0 ? (
            <p className="changes-muted">Keine lokalen Aenderungen gefunden.</p>
          ) : (
            <div className="changes-group-list">
              {groupedChanges.map(([project, items]) => (
                <div key={project} className="changes-group">
                  <h4>{project}</h4>
                  {items.map((change) => (
                    <div key={change.path} className="changes-file-row">
                      <span className={`changes-state changes-state-${change.state}`}>
                        {stateLabel(change.state)}
                      </span>
                      <span className="changes-file-path">{change.path}</span>
                      <span className="changes-file-area">{change.area}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card changes-panel">
          <div className="changes-panel-header">
            <h3>Letzte Commits</h3>
            <span className="badge badge-neutral">{commits.length}</span>
          </div>
          {loading ? (
            <p className="changes-muted">Lade Commits...</p>
          ) : commits.length === 0 ? (
            <p className="changes-muted">Keine Commit-Historie gefunden.</p>
          ) : (
            <div className="changes-commit-list">
              {commits.map((commit) => (
                <div key={commit.oid} className="changes-commit-row">
                  <code>{shortOid(commit.oid)}</code>
                  <div>
                    <strong>{commit.message}</strong>
                    <span>{formatDate(commit.date)} · {commit.authorName || commit.authorEmail || 'unbekannt'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
