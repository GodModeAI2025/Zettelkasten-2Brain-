import { useState } from 'react';
import { useAppStore, type ErrorEntry } from '../../stores/app.store';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ErrorDialog() {
  const errorQueue = useAppStore((s) => s.errorQueue);
  const dismissError = useAppStore((s) => s.dismissError);
  const dismissAllErrors = useAppStore((s) => s.dismissAllErrors);
  const [copied, setCopied] = useState<string | null>(null);

  if (errorQueue.length === 0) return null;

  const handleCopy = async (entry: ErrorEntry) => {
    try {
      await navigator.clipboard.writeText(entry.message);
      setCopied(entry.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = entry.message;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(entry.id);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const handleCopyAll = async () => {
    const text = errorQueue
      .map((e) => `[${formatTime(e.timestamp)}] ${e.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('all');
      setTimeout(() => setCopied(null), 2000);
    } catch { /* Ignorieren */ }
  };

  return (
    <div className="error-dialog-overlay" onClick={dismissAllErrors}>
      <div className="error-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="error-dialog-header">
          <div className="error-dialog-title">
            <span className="error-dialog-icon">!</span>
            <h3>
              {errorQueue.length === 1
                ? 'Fehler aufgetreten'
                : `${errorQueue.length} Fehler aufgetreten`}
            </h3>
          </div>
          <button
            className="error-dialog-close"
            onClick={dismissAllErrors}
            title="Alle schließen"
          >
            &times;
          </button>
        </div>

        <div className="error-dialog-body">
          {errorQueue.map((entry) => (
            <div key={entry.id} className="error-dialog-entry">
              <div className="error-dialog-entry-header">
                <span className="error-dialog-time">
                  {formatTime(entry.timestamp)}
                </span>
                <div className="error-dialog-entry-actions">
                  <button
                    className="error-dialog-copy-btn"
                    onClick={() => handleCopy(entry)}
                    title="In Zwischenablage kopieren"
                  >
                    {copied === entry.id ? 'Kopiert!' : 'Kopieren'}
                  </button>
                  {errorQueue.length > 1 && (
                    <button
                      className="error-dialog-dismiss-btn"
                      onClick={() => dismissError(entry.id)}
                      title="Diesen Fehler schließen"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>
              <pre className="error-dialog-message">{entry.message}</pre>
            </div>
          ))}
        </div>

        <div className="error-dialog-footer">
          {errorQueue.length > 1 && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleCopyAll}
            >
              {copied === 'all' ? 'Alle kopiert!' : 'Alle kopieren'}
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={dismissAllErrors}
          >
            {errorQueue.length === 1 ? 'Schließen' : 'Alle schließen'}
          </button>
        </div>
      </div>
    </div>
  );
}
