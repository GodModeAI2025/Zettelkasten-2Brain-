import { create } from 'zustand';

export type OutputPhase = 'idle' | 'generating' | 'complete' | 'error';

export interface OutputJob {
  outputName: string;
  phase: OutputPhase;
  message: string;
  startedAt: number;
}

interface OutputState {
  jobs: Record<string, OutputJob>;
  startJob: (outputName: string) => void;
  updateJob: (outputName: string, phase: OutputPhase, message: string) => void;
  clearJob: (outputName: string) => void;
}

export const useOutputStore = create<OutputState>((set) => ({
  jobs: {},

  startJob: (outputName) =>
    set((s) => ({
      jobs: {
        ...s.jobs,
        [outputName]: { outputName, phase: 'generating', message: 'Generierung gestartet...', startedAt: Date.now() },
      },
    })),

  updateJob: (outputName, phase, message) =>
    set((s) => {
      const existing = s.jobs[outputName];
      return {
        jobs: {
          ...s.jobs,
          [outputName]: {
            outputName,
            phase,
            message,
            startedAt: existing?.startedAt ?? Date.now(),
          },
        },
      };
    }),

  clearJob: (outputName) =>
    set((s) => {
      const { [outputName]: _, ...rest } = s.jobs;
      return { jobs: rest };
    }),
}));
