import { useState, useEffect } from 'react';

interface ProgressEntry {
  file: string;
  step: string;
  message: string;
}

type IngestPhase = 'idle' | 'running' | 'committing' | 'complete' | 'error';

interface IngestProgressProps {
  entries: ProgressEntry[];
  phase: IngestPhase;
  totalFiles: number;
  processedFiles: number;
  summaryMessage: string;
  startedAt: number | null;
}

function stepIcon(step: string): string {
  switch (step) {
    case 'analyzing': return '\u2699';
    case 'thinking': return '\u25D4';
    case 'converting': return '\u21BB';
    case 'writing': return '\u270F';
    case 'done': return '\u2713';
    case 'error': return '\u2717';
    case 'tokens': return '\u2261';
    case 'warning': return '\u26A0';
    default: return '\u2022';
  }
}

function stepLabel(step: string): string {
  switch (step) {
    case 'analyzing': return 'KI analysiert';
    case 'thinking': return 'KI denkt nach';
    case 'converting': return 'Konvertiere';
    case 'writing': return 'Schreibe Wiki-Seiten';
    case 'done': return 'Fertig';
    case 'error': return 'Fehler';
    case 'tokens': return 'API-Antwort';
    case 'warning': return 'Warnung';
    default: return step;
  }
}

function stepOrder(step: string): number {
  switch (step) {
    case 'analyzing':
    case 'thinking':
    case 'converting':
    case 'writing':
    case 'tokens':
      return 0; // Aktiv → oben
    case 'done': return 1;
    case 'error': return 2;
    default: return 3;
  }
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

interface FileStatus {
  file: string;
  step: string;
  message: string;
  tokens?: string;
  warning?: string;
}

function buildFileStatuses(entries: ProgressEntry[]): FileStatus[] {
  const groups = new Map<string, ProgressEntry[]>();
  for (const entry of entries) {
    if (entry.file === '__summary__') continue;
    const group = groups.get(entry.file) || [];
    group.push(entry);
    groups.set(entry.file, group);
  }

  return [...groups.entries()].map(([file, fileEntries]) => {
    const latest = fileEntries[fileEntries.length - 1];
    const tokenEntry = fileEntries.find((e) => e.step === 'tokens');
    const warningEntry = fileEntries.find((e) => e.step === 'warning');
    return {
      file,
      step: latest.step,
      message: latest.message,
      tokens: tokenEntry?.message,
      warning: warningEntry?.message,
    };
  });
}

function ProgressTimer({ startedAt, processedFiles, totalFiles }: {
  startedAt: number | null;
  processedFiles: number;
  totalFiles: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!startedAt) return null;

  const elapsedSec = (now - startedAt) / 1000;
  const elapsed = formatTime(elapsedSec);

  let eta = '';
  if (processedFiles > 0 && processedFiles < totalFiles) {
    const secPerFile = elapsedSec / processedFiles;
    const remainingSec = secPerFile * (totalFiles - processedFiles);
    eta = `~${formatTime(remainingSec)} verbl.`;
  }

  return (
    <span className="ingest-timer">
      <span>{elapsed}</span>
      {eta && <span className="ingest-timer-eta">{eta}</span>}
    </span>
  );
}

export function IngestProgress({ entries, phase, totalFiles, processedFiles, summaryMessage, startedAt }: IngestProgressProps) {
  if (phase === 'idle') return null;

  const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
  const isComplete = phase === 'complete';
  const isCommitting = phase === 'committing';
  const isActive = phase === 'running' || phase === 'committing';

  const fileStatuses = buildFileStatuses(entries);
  const sorted = [...fileStatuses].sort((a, b) => stepOrder(a.step) - stepOrder(b.step));
  const doneCount = fileStatuses.filter((f) => f.step === 'done').length;
  const errorCount = fileStatuses.filter((f) => f.step === 'error').length;

  return (
    <div className={`ingest-card ${isComplete ? 'ingest-card-complete' : ''}`}>
      {/* Header */}
      <div className="ingest-header">
        <div className="ingest-header-left">
          {isActive && <span className="ingest-active-dot" />}
          <h3>
            {isComplete ? 'Ingest abgeschlossen' : isCommitting ? 'Git-Commit...' : 'Ingest läuft...'}
          </h3>
        </div>
        <div className="ingest-header-right">
          {isActive && <ProgressTimer startedAt={startedAt} processedFiles={processedFiles} totalFiles={totalFiles} />}
          {!isComplete && (
            <span className="ingest-counter">{processedFiles} / {totalFiles}</span>
          )}
          {isComplete && (
            <span className="ingest-counter">
              {doneCount} fertig{errorCount > 0 ? `, ${errorCount} Fehler` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Fortschrittsbalken */}
      <div className="ingest-bar-track">
        <div
          className={`ingest-bar-fill ${isComplete ? 'ingest-bar-complete' : ''} ${isActive && percent < 100 ? 'ingest-bar-pulse' : ''}`}
          style={{ width: `${isComplete ? 100 : Math.max(percent, isActive ? 3 : 0)}%` }}
        />
      </div>

      {/* Committing */}
      {isCommitting && (
        <div className="ingest-active-file ingest-committing">
          <span className="ingest-active-spinner">{'\u21BB'}</span>
          <span>{summaryMessage || 'Git-Commit...'}</span>
        </div>
      )}

      {/* Abschluss-Banner */}
      {isComplete && summaryMessage && (
        <div className="ingest-complete-banner">
          <span>{'\u2713'}</span>
          <span>{summaryMessage}</span>
        </div>
      )}

      {/* Datei-Liste mit Status */}
      {sorted.length > 0 && (
        <div className="ingest-file-status-list">
          {sorted.map((fs) => {
            const isFileActive = stepOrder(fs.step) === 0;
            const isError = fs.step === 'error';
            const isDone = fs.step === 'done';

            return (
              <div
                key={fs.file}
                className={`ingest-file-status${isFileActive ? ' ingest-file-active' : ''}${isDone ? ' ingest-file-done' : ''}${isError ? ' ingest-file-error' : ''}`}
              >
                <span className="ingest-file-icon">
                  {isFileActive && <span className="ingest-active-dot-sm" />}
                  {!isFileActive && stepIcon(fs.step)}
                </span>
                <span className="ingest-file-name">{fs.file}</span>
                <span className="ingest-file-step">{fs.step === 'thinking' ? fs.message : stepLabel(fs.step)}</span>
                {fs.tokens && <span className="ingest-file-tokens">{fs.tokens}</span>}
                {fs.warning && <span className="ingest-file-warning">{'\u26A0'} {fs.warning}</span>}
                {isError && <div className="ingest-file-error-msg">{fs.message}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
