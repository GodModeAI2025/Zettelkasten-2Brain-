import { useState, useEffect } from 'react';

interface ProgressEntry {
  file: string;
  step: string;
  message: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryDelayMs?: number;
}

type IngestPhase = 'idle' | 'running' | 'committing' | 'complete' | 'cancelled' | 'error';

interface IngestProgressProps {
  entries: ProgressEntry[];
  phase: IngestPhase;
  totalFiles: number;
  processedFiles: number;
  summaryMessage: string;
  startedAt: number | null;
  onCancel?: () => void;
  cancelling?: boolean;
}

function stepIcon(step: string): string {
  switch (step) {
    case 'pending': return '\u25CB';
    case 'analyzing': return '\u2699';
    case 'thinking': return '\u25D4';
    case 'retrying': return '\u21BB';
    case 'converting': return '\u21BB';
    case 'writing': return '\u270F';
    case 'done': return '\u2713';
    case 'cancelled': return '\u2212';
    case 'error': return '\u2717';
    case 'tokens': return '\u2261';
    case 'warning': return '\u26A0';
    default: return '\u2022';
  }
}

function stepLabel(step: string): string {
  switch (step) {
    case 'pending': return 'Wartet';
    case 'analyzing': return 'KI analysiert';
    case 'thinking': return 'KI denkt nach';
    case 'retrying': return 'API wiederholt';
    case 'converting': return 'Konvertiere';
    case 'writing': return 'Schreibe Wiki-Seiten';
    case 'done': return 'OK';
    case 'cancelled': return 'Abgebrochen';
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
    case 'retrying':
    case 'tokens':
      return 0; // Aktiv → oben
    case 'pending': return 1;
    case 'done': return 2;
    case 'cancelled': return 3;
    case 'error': return 4;
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
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  tokenMessage?: string;
  warning?: string;
  retry?: string;
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
    const retryEntry = [...fileEntries].reverse().find((e) => e.step === 'retrying');
    return {
      file,
      step: latest.step,
      message: latest.message,
      inputTokens: tokenEntry?.inputTokens,
      outputTokens: tokenEntry?.outputTokens,
      costUsd: tokenEntry?.costUsd,
      tokenMessage: tokenEntry?.message,
      warning: warningEntry?.message,
      retry: retryEntry?.message,
    };
  });
}

function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString('de');
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
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

export function IngestProgress({
  entries,
  phase,
  totalFiles,
  processedFiles,
  summaryMessage,
  startedAt,
  onCancel,
  cancelling = false,
}: IngestProgressProps) {
  if (phase === 'idle') return null;

  const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
  const isComplete = phase === 'complete';
  const isCancelled = phase === 'cancelled';
  const isCommitting = phase === 'committing';
  const isActive = phase === 'running' || phase === 'committing';

  const fileStatuses = buildFileStatuses(entries);
  const sorted = [...fileStatuses].sort((a, b) => stepOrder(a.step) - stepOrder(b.step));
  const doneCount = fileStatuses.filter((f) => f.step === 'done').length;
  const errorCount = fileStatuses.filter((f) => f.step === 'error').length;
  const cancelledCount = fileStatuses.filter((f) => f.step === 'cancelled').length;
  const totalInputTokens = fileStatuses.reduce((sum, f) => sum + (f.inputTokens || 0), 0);
  const totalOutputTokens = fileStatuses.reduce((sum, f) => sum + (f.outputTokens || 0), 0);
  const knownCostItems = fileStatuses.filter((f) => typeof f.costUsd === 'number');
  const totalCost = knownCostItems.reduce((sum, f) => sum + (f.costUsd || 0), 0);

  return (
    <div className={`ingest-card ${isComplete ? 'ingest-card-complete' : ''}${isCancelled ? ' ingest-card-cancelled' : ''}`}>
      {/* Header */}
      <div className="ingest-header">
        <div className="ingest-header-left">
          {isActive && <span className="ingest-active-dot" />}
          <h3>
            {isComplete ? 'Ingest abgeschlossen' : isCancelled ? 'Ingest abgebrochen' : isCommitting ? 'Git-Commit...' : 'Ingest läuft...'}
          </h3>
        </div>
        <div className="ingest-header-right">
          {isActive && <ProgressTimer startedAt={startedAt} processedFiles={processedFiles} totalFiles={totalFiles} />}
          {totalInputTokens + totalOutputTokens > 0 && (
            <span className="ingest-token-total">
              {formatTokenCount(totalInputTokens)} in / {formatTokenCount(totalOutputTokens)} out
            </span>
          )}
          {knownCostItems.length > 0 && (
            <span className="ingest-cost-total">~ {formatCost(totalCost)}</span>
          )}
          {!isComplete && (
            <span className="ingest-counter">{processedFiles} / {totalFiles}</span>
          )}
          {isComplete && (
            <span className="ingest-counter">
              {doneCount} fertig{errorCount > 0 ? `, ${errorCount} Fehler` : ''}
            </span>
          )}
          {isActive && onCancel && (
            <button className="btn btn-secondary btn-sm ingest-cancel-btn" onClick={onCancel} disabled={cancelling}>
              {cancelling ? 'Stoppe...' : 'Abbrechen'}
            </button>
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

      {isCancelled && summaryMessage && (
        <div className="ingest-cancelled-banner">
          <span>{'\u2212'}</span>
          <span>{summaryMessage}{cancelledCount > 0 ? ` (${cancelledCount} abgebrochen)` : ''}</span>
        </div>
      )}

      {/* Datei-Liste mit Status */}
      {sorted.length > 0 && (
        <div className="ingest-file-status-list">
          {sorted.map((fs) => {
            const isFileActive = stepOrder(fs.step) === 0;
            const isError = fs.step === 'error';
            const isDone = fs.step === 'done';
            const isCancelledFile = fs.step === 'cancelled';

            return (
              <div
                key={fs.file}
                className={`ingest-file-status${isFileActive ? ' ingest-file-active' : ''}${isDone ? ' ingest-file-done' : ''}${isError ? ' ingest-file-error' : ''}${isCancelledFile ? ' ingest-file-cancelled' : ''}`}
              >
                <span className="ingest-file-icon">
                  {isFileActive && <span className="ingest-active-dot-sm" />}
                  {!isFileActive && stepIcon(fs.step)}
                </span>
                <span className="ingest-file-name">{fs.file}</span>
                <span className="ingest-file-step">{fs.step === 'thinking' ? fs.message : stepLabel(fs.step)}</span>
                {typeof fs.costUsd === 'number' && <span className="ingest-file-cost">~ {formatCost(fs.costUsd)}</span>}
                {fs.tokenMessage && <span className="ingest-file-tokens">{fs.tokenMessage}</span>}
                {fs.retry && isFileActive && <span className="ingest-file-retry">{fs.retry}</span>}
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
