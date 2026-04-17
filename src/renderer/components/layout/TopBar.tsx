import { useState, useRef, useEffect } from 'react';
import { useGitStore } from '../../stores/git.store';
import { useAppStore } from '../../stores/app.store';
import { useProjectStore } from '../../stores/project.store';
import { useActivityStore } from '../../stores/activity.store';
import { api } from '../../api/bridge';
import { ConfirmDialog } from '../shared/ConfirmDialog';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const THEME_CYCLE: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
const THEME_ICONS: Record<string, string> = { system: '\u25D1', light: '\u2600', dark: '\u263E' };
const THEME_LABELS: Record<string, string> = { system: 'System', light: 'Hell', dark: 'Dunkel' };

export function TopBar({ title }: { title: string }) {
  const { syncing, error, lastSync, sync } = useGitStore();
  const online = useAppStore((s) => s.online);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const addNotification = useAppStore((s) => s.addNotification);
  const activeProject = useProjectStore((s) => s.activeProject);
  const activities = useActivityStore((s) => s.activities);
  const errors = useActivityStore((s) => s.errors);
  const dismissError = useActivityStore((s) => s.dismissError);
  const clearErrors = useActivityStore((s) => s.clearErrors);

  const [errorPanelOpen, setErrorPanelOpen] = useState(false);
  const [confirmForce, setConfirmForce] = useState<'push' | 'pull' | null>(null);
  const [forceRunning, setForceRunning] = useState(false);
  const [atRisk, setAtRisk] = useState<Array<{ project: string; path: string; full: string }>>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setErrorPanelOpen(false);
      }
    }
    if (errorPanelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [errorPanelOpen]);

  const cycleTheme = async () => {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setTheme(next);
    await api.settings.set({ ui: { theme: next, language: 'de', sidebarCollapsed: false } });
  };

  const openForceDialog = async (kind: 'push' | 'pull') => {
    if (kind === 'pull') {
      try {
        const result = await api.git.atRiskFiles();
        setAtRisk(result.files);
      } catch {
        setAtRisk([]);
      }
    } else {
      setAtRisk([]);
    }
    setConfirmForce(kind);
  };

  const handleForceAction = async () => {
    if (!confirmForce) return;
    setForceRunning(true);
    try {
      const result = confirmForce === 'push'
        ? await api.git.forcePush()
        : await api.git.forcePull();
      if (result.success) {
        addNotification('success', confirmForce === 'push'
          ? 'Force Push erfolgreich — Remote überschrieben.'
          : 'Force Pull erfolgreich — Lokale Dateien durch Remote ersetzt.');
      } else {
        addNotification('error', `Force ${confirmForce} fehlgeschlagen: ${result.error}`);
      }
    } catch (err) {
      addNotification('error', `Force ${confirmForce} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setForceRunning(false);
      setConfirmForce(null);
      setAtRisk([]);
    }
  };

  const activeStatus = useProjectStore((s) => s.activeStatus);
  const refreshStatus = useProjectStore((s) => s.refreshStatus);
  const syncEnabled = activeStatus?.syncEnabled !== false;

  const toggleSync = async () => {
    if (!activeProject) return;
    const next = !syncEnabled;
    await api.project.setConfig(activeProject, { syncEnabled: next });
    await refreshStatus();
    addNotification('success', next ? 'Sync aktiviert' : 'Sync pausiert');
    if (next && online) sync();
  };

  const badgeClass = !syncEnabled ? 'paused' : !online ? 'error' : syncing ? 'syncing' : error ? 'error' : 'synced';
  const badgeText = !syncEnabled
    ? 'Sync pausiert'
    : !online
      ? 'Offline'
      : syncing
        ? 'Synchronisiere...'
        : error
          ? 'Sync-Fehler'
          : 'Synchron';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1>{title}</h1>
        {activeProject && (
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 400 }}>
            / {activeProject}
          </span>
        )}
      </div>
      <div className="topbar-right">
        {activities.map((act) => (
          <span key={act.id} className="activity-indicator">
            <span className="activity-spinner" />
            <span className="activity-label">{act.label}</span>
            {act.progress != null && (
              <span className="activity-progress">{act.progress}%</span>
            )}
          </span>
        ))}

        {errors.length > 0 && (
          <div style={{ position: 'relative' }} ref={panelRef}>
            <button
              className="error-badge"
              onClick={() => setErrorPanelOpen((v) => !v)}
              title={`${errors.length} Fehler`}
            >
              {errors.length}
            </button>
            {errorPanelOpen && (
              <div className="error-panel">
                <div className="error-panel-header">
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Fehler ({errors.length})</span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => { clearErrors(); setErrorPanelOpen(false); }}
                    style={{ fontSize: 11, padding: '2px 8px' }}
                  >
                    Alle verwerfen
                  </button>
                </div>
                <div className="error-panel-list">
                  {errors.map((err) => (
                    <div key={err.id} className="error-panel-item">
                      <div className="error-panel-item-content">
                        <span className="error-panel-item-msg">{err.message}</span>
                        <span className="error-panel-item-time">{formatTimestamp(err.timestamp)}</span>
                      </div>
                      <button
                        className="error-panel-item-dismiss"
                        onClick={() => dismissError(err.id)}
                        title="Verwerfen"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {lastSync && !syncing && online && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {formatTime(lastSync)}
          </span>
        )}
        <button
          className={`sync-badge ${badgeClass}`}
          onClick={syncEnabled ? sync : toggleSync}
          disabled={syncEnabled && (syncing || !online)}
          title={
            !syncEnabled
              ? 'Klicken um Sync zu aktivieren'
              : error || (lastSync ? `Letzter Sync: ${formatTime(lastSync)}` : '')
          }
        >
          {badgeText}
        </button>
        {syncEnabled && activeProject && (
          <button
            className="topbar-icon-btn"
            onClick={toggleSync}
            title="Sync pausieren"
            style={{ fontSize: 13 }}
          >
            {'\u23F8'}
          </button>
        )}

        {online && syncEnabled && (
          <>
            <button
              className="topbar-icon-btn"
              onClick={() => openForceDialog('pull')}
              disabled={syncing || forceRunning}
              title="Force Pull — Lokale Änderungen verwerfen, Remote übernehmen"
            >
              {'\u2B07'}
            </button>
            <button
              className="topbar-icon-btn"
              onClick={() => openForceDialog('push')}
              disabled={syncing || forceRunning}
              title="Force Push — Remote mit lokalen Daten überschreiben"
            >
              {'\u2B06'}
            </button>
          </>
        )}

        <button
          className="topbar-icon-btn"
          onClick={cycleTheme}
          title={`Theme: ${THEME_LABELS[theme]}`}
        >
          {THEME_ICONS[theme]}
        </button>
      </div>

      {confirmForce && (
        <ConfirmDialog
          title={confirmForce === 'push' ? 'Force Push' : 'Force Pull'}
          message={
            confirmForce === 'push'
              ? 'Force Push überschreibt das Remote-Repository mit deinen lokalen Daten. Änderungen anderer Geräte gehen dabei verloren. Gilt für ALLE Projekte. Fortfahren?'
              : atRisk.length > 0
                ? `Force Pull verwirft ALLE lokalen Änderungen und ersetzt sie durch die Remote-Version.\n\n⚠ ${atRisk.length} ungespeicherte Datei(en) in raw/ oder wiki/ werden unwiederbringlich gelöscht — darunter: ${atRisk.slice(0, 5).map((f) => `${f.project}/${f.path}`).join(', ')}${atRisk.length > 5 ? ` … +${atRisk.length - 5} weitere` : ''}.\n\nTipp: Betroffene Projekte mit syncEnabled=false committen ihre Dateien nie — prüfe zuerst, ob du Sync aktivieren willst.\n\nFortfahren?`
                : 'Force Pull verwirft alle lokalen Änderungen und ersetzt sie durch die Remote-Version. Nicht gepushte Änderungen gehen dabei verloren. Gilt für ALLE Projekte. Fortfahren?'
          }
          confirmLabel={forceRunning ? 'Läuft...' : (confirmForce === 'push' ? 'Force Push' : 'Force Pull')}
          danger
          onConfirm={handleForceAction}
          onCancel={() => { setConfirmForce(null); setAtRisk([]); }}
        />
      )}
    </header>
  );
}
