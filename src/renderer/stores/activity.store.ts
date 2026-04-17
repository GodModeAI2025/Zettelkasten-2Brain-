import { create } from 'zustand';

export interface Activity {
  id: string;
  label: string;
  progress?: number; // 0-100, optional
  error?: string;
}

export interface ActivityError {
  id: string;
  message: string;
  timestamp: number;
}

interface ActivityState {
  activities: Activity[];
  errors: ActivityError[];
  startActivity: (id: string, label: string) => void;
  updateActivity: (id: string, progress: number) => void;
  finishActivity: (id: string) => void;
  failActivity: (id: string, error: string) => void;
  addError: (message: string) => void;
  dismissError: (id: string) => void;
  clearErrors: () => void;
}

let errorCounter = 0;

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  errors: [],

  startActivity: (id, label) =>
    set((s) => ({
      activities: [...s.activities.filter((a) => a.id !== id), { id, label }],
    })),

  updateActivity: (id, progress) =>
    set((s) => ({
      activities: s.activities.map((a) =>
        a.id === id ? { ...a, progress } : a,
      ),
    })),

  finishActivity: (id) =>
    set((s) => ({
      activities: s.activities.filter((a) => a.id !== id),
    })),

  failActivity: (id, error) =>
    set((s) => {
      const errId = String(++errorCounter);
      return {
        activities: s.activities.filter((a) => a.id !== id),
        errors: [...s.errors, { id: errId, message: error, timestamp: Date.now() }],
      };
    }),

  addError: (message) =>
    set((s) => {
      const errId = String(++errorCounter);
      return {
        errors: [...s.errors, { id: errId, message, timestamp: Date.now() }],
      };
    }),

  dismissError: (id) =>
    set((s) => ({
      errors: s.errors.filter((e) => e.id !== id),
    })),

  clearErrors: () => set({ errors: [] }),
}));
