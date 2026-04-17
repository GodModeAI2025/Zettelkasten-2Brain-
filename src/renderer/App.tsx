import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { Shell } from './components/layout/Shell';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { WelcomePage } from './pages/WelcomePage';
import { DashboardPage } from './pages/DashboardPage';
import { RawPage } from './pages/RawPage';
import { WikiPage } from './pages/WikiPage';
import { IngestPage } from './pages/IngestPage';
import { GraphPage } from './pages/GraphPage';
import { QueryPage } from './pages/QueryPage';
import { LintPage } from './pages/LintPage';
import { OutputPage } from './pages/OutputPage';
import { BrandPage } from './pages/BrandPage';
import { SettingsPage } from './pages/SettingsPage';
import { api, hasApi } from './api/bridge';
import { useProjectStore } from './stores/project.store';
import { useGitStore } from './stores/git.store';
import { useAppStore } from './stores/app.store';
import { useIngestStore } from './stores/ingest.store';
import { useOutputStore, type OutputPhase } from './stores/output.store';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 Minuten

export function App() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const { loadProjects, setActiveProject } = useProjectStore();
  const setGitSyncing = useGitStore((s) => s.setSyncing);
  const setGitError = useGitStore((s) => s.setError);
  const setLastSync = useGitStore((s) => s.setLastSync);
  const setOnline = useAppStore((s) => s.setOnline);
  const setTheme = useAppStore((s) => s.setTheme);

  const addIngestProgress = useIngestStore((s) => s.addProgress);
  const updateOutputJob = useOutputStore((s) => s.updateJob);
  const addNotification = useAppStore((s) => s.addNotification);

  // Globaler Ingest-Listener — bleibt aktiv unabhaengig von der Seite
  useEffect(() => {
    if (!hasApi) return;
    return api.on('ingest:progress', (data: unknown) => {
      const entry = data as { file: string; step: string; message: string };
      addIngestProgress(entry);
    });
  }, [addIngestProgress]);

  // Globaler Output-Listener — verfolgt Generierung auch bei Navigation
  useEffect(() => {
    if (!hasApi) return;
    return api.on('output:progress', (data: unknown) => {
      const { outputName, phase, message } = data as { outputName: string; phase: string; message: string };
      updateOutputJob(outputName, phase as OutputPhase, message);
      if (phase === 'complete') {
        addNotification('success', message);
      } else if (phase === 'error') {
        addNotification('error', message);
      }
    });
  }, [updateOutputJob, addNotification]);

  // Online/Offline-Erkennung
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [setOnline]);

  const autoSync = useCallback(async () => {
    if (!navigator.onLine || !hasApi) return;
    try {
      setGitSyncing(true);
      await api.git.sync();
      setLastSync(new Date().toISOString());
      setGitError(null);
    } catch (err) {
      setGitError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitSyncing(false);
    }
  }, [setGitSyncing, setGitError, setLastSync]);

  useEffect(() => {
    (async () => {
      try {
        if (!hasApi) {
          setInitError('Bridge API nicht verfügbar. Preload-Script nicht geladen.');
          setNeedsSetup(true);
          return;
        }

        let gitOk = false;
        try {
          const gitStatus = await api.git.status();
          gitOk = !!gitStatus;
        } catch {
          // Git nicht konfiguriert
        }

        if (!gitOk) {
          setNeedsSetup(true);
          return;
        }

        // Initial pull (nicht blockierend)
        autoSync().catch(() => {});

        await loadProjects();
        try {
          const settings = await api.settings.get();
          if (settings?.activeProjectName) {
            await setActiveProject(settings.activeProjectName);
          }
          if (settings?.ui?.theme) {
            setTheme(settings.ui.theme);
          }
        } catch {
          // Settings nicht lesbar
        }
        setNeedsSetup(false);
      } catch (err) {
        console.error('[App] Init error:', err);
        setInitError(err instanceof Error ? err.message : String(err));
        setNeedsSetup(true);
      }
    })();
  }, []);

  // Auto-Sync alle 5 Minuten
  useEffect(() => {
    if (needsSetup !== false) return;
    const interval = setInterval(autoSync, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [needsSetup, autoSync]);

  // Sync bei App-Focus
  useEffect(() => {
    if (needsSetup !== false) return;
    const handleFocus = () => autoSync();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [needsSetup, autoSync]);

  if (needsSetup === null) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-secondary, #F2F2F7)',
      }}>
        <h2 style={{ color: 'var(--text-primary, #000)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>2Brain</h2>
        <p style={{ color: 'var(--text-secondary, #8E8E93)', fontSize: 14 }}>Wird geladen...</p>
        {initError && (
          <p style={{ color: '#dc3545', fontSize: 13, marginTop: 12, maxWidth: 400, textAlign: 'center' }}>
            {initError}
          </p>
        )}
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          {needsSetup ? (
            <>
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="*" element={<Navigate to="/welcome" replace />} />
            </>
          ) : (
            <>
              <Route element={<Shell />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/raw" element={<RawPage />} />
                <Route path="/wiki/*" element={<WikiPage />} />
                <Route path="/graph" element={<GraphPage />} />
                <Route path="/ingest" element={<IngestPage />} />
                <Route path="/query" element={<QueryPage />} />
                <Route path="/lint" element={<LintPage />} />
                <Route path="/output/*" element={<OutputPage />} />
                <Route path="/brand" element={<BrandPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </>
          )}
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
