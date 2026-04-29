import { create } from 'zustand';

export interface ProgressEntry {
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

export interface IngestSummary {
  takeaways: string[];
  summary: {
    created: string[];
    updated: string[];
    contradictions: string[];
    superseded: Array<{ old: string; new: string }>;
  };
}

type IngestPhase = 'idle' | 'running' | 'committing' | 'complete' | 'cancelled' | 'error';

interface IngestState {
  phase: IngestPhase;
  progress: ProgressEntry[];
  results: IngestSummary[];
  summaryMessage: string;
  totalFiles: number;
  processedFiles: number;
  startedAt: number | null;

  start: (totalFiles: number) => void;
  addProgress: (entry: ProgressEntry) => void;
  setResults: (results: IngestSummary[]) => void;
  reset: () => void;
}

export const useIngestStore = create<IngestState>((set) => ({
  phase: 'idle',
  progress: [],
  results: [],
  summaryMessage: '',
  totalFiles: 0,
  processedFiles: 0,
  startedAt: null,

  start: (totalFiles) =>
    set({
      phase: 'running',
      progress: [],
      results: [],
      summaryMessage: '',
      totalFiles,
      processedFiles: 0,
      startedAt: Date.now(),
    }),

  addProgress: (entry) =>
    set((s) => {
      // Summary-Events aktualisieren Phase und Zaehler
      if (entry.file === '__summary__') {
        if (entry.step === 'complete') {
          return { phase: 'complete', summaryMessage: entry.message };
        }
        if (entry.step === 'cancelled') {
          return { phase: 'cancelled', summaryMessage: entry.message };
        }
        if (entry.step === 'committing') {
          return { phase: 'committing', summaryMessage: entry.message };
        }
        if (entry.step === 'empty') {
          return { phase: 'complete', summaryMessage: entry.message };
        }
        if (entry.step === 'progress') {
          const match = entry.message.match(/^(\d+) von (\d+)/);
          return match
            ? { processedFiles: parseInt(match[1]), totalFiles: parseInt(match[2]) }
            : {};
        }
        return {};
      }
      // Heartbeat-Ticks ('thinking') koaleszieren: letzten fuer dieselbe
      // Datei ersetzen statt anfuegen, sonst waechst die Liste unbegrenzt.
      if (entry.step === 'thinking') {
        const idx = [...s.progress].reverse().findIndex((e) => e.file === entry.file && e.step === 'thinking');
        if (idx >= 0) {
          const realIdx = s.progress.length - 1 - idx;
          const next = [...s.progress];
          next[realIdx] = entry;
          return { progress: next };
        }
      }
      // Normale File-Events zur Liste hinzufuegen
      return { progress: [...s.progress, entry] };
    }),

  setResults: (results) => set({ results }),

  reset: () =>
    set({
      phase: 'idle',
      progress: [],
      results: [],
      summaryMessage: '',
      totalFiles: 0,
      processedFiles: 0,
      startedAt: null,
    }),
}));
