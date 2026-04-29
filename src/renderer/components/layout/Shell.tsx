import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { useAppStore } from '../../stores/app.store';
import { useActivityStore } from '../../stores/activity.store';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { ErrorDialog } from '../shared/ErrorDialog';

export function Shell() {
  const { notifications, dismissNotification, online } = useAppStore();
  const activities = useActivityStore((s) => s.activities);
  const navigate = useNavigate();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault();
          setCommandPaletteOpen(true);
          break;
        case 'u':
          e.preventDefault();
          if (commandPaletteOpen) break;
          navigate('/raw');
          break;
        case 'i':
          e.preventDefault();
          if (commandPaletteOpen) break;
          navigate('/ingest');
          break;
        case 'w':
          e.preventDefault();
          if (commandPaletteOpen) break;
          navigate('/wiki');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, commandPaletteOpen]);

  // Aggregate progress across all activities (indeterminate if none have progress)
  const activitiesWithProgress = activities.filter((a) => a.progress != null);
  const hasProgress = activitiesWithProgress.length > 0;
  const avgProgress = hasProgress
    ? Math.round(activitiesWithProgress.reduce((sum, a) => sum + (a.progress ?? 0), 0) / activitiesWithProgress.length)
    : undefined;

  return (
    <div className="app-shell">
      <Sidebar />
      <TopBar title="2Brain" />
      <main className="content">
        {activities.length > 0 && (
          <div className="activity-bar-wrapper">
            <div
              className={`activity-bar ${hasProgress ? '' : 'activity-bar-indeterminate'}`}
              style={hasProgress ? { width: `${avgProgress}%` } : undefined}
            />
          </div>
        )}
        {!online && (
          <div className="offline-banner">
            Offline &mdash; Git-Sync und KI-Funktionen sind nicht verfügbar.
          </div>
        )}
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Success/Info Toasts */}
      {notifications.length > 0 && (
        <div className="notifications">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`notification ${n.type}`}
              onClick={() => dismissNotification(n.id)}
            >
              {n.message}
            </div>
          ))}
        </div>
      )}

      {/* Fehler-Dialog */}
      <ErrorDialog />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}
