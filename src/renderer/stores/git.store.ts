import { create } from 'zustand';
import { api } from '../api/bridge';

interface GitState {
  syncing: boolean;
  cloned: boolean;
  lastSync: string | null;
  ahead: number;
  behind: number;
  error: string | null;
  sync: () => Promise<void>;
  checkStatus: () => Promise<void>;
  setCloned: (v: boolean) => void;
  setSyncing: (v: boolean) => void;
  setError: (v: string | null) => void;
  setLastSync: (v: string) => void;
}

export const useGitStore = create<GitState>((set) => ({
  syncing: false,
  cloned: false,
  lastSync: null,
  ahead: 0,
  behind: 0,
  error: null,

  sync: async () => {
    set({ syncing: true, error: null });
    try {
      await api.git.sync();
      set({ syncing: false, lastSync: new Date().toISOString() });
    } catch (err) {
      set({ syncing: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  checkStatus: async () => {
    try {
      const status = await api.git.status();
      set({ ahead: status.ahead, behind: status.behind, cloned: true });
    } catch {
      set({ cloned: false });
    }
  },

  setCloned: (v) => set({ cloned: v }),
  setSyncing: (v) => set({ syncing: v }),
  setError: (v) => set({ error: v }),
  setLastSync: (v) => set({ lastSync: v }),
}));
