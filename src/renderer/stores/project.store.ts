import { create } from 'zustand';
import { api } from '../api/bridge';

export interface ProjectInfo {
  name: string;
  domain: string;
  language: string;
}

export interface ProjectStatus {
  totalPages: number;
  sources: number;
  entities: number;
  concepts: number;
  synthesis: number;
  syntheses: number;
  sops: number;
  decisions: number;
  confirmed: number;
  seed: number;
  stale: number;
  unreviewed: number;
  rawTotal: number;
  rawNew: number;
  lastIngest: string;
  lastLint: string;
  syncEnabled: boolean;
}

interface ProjectState {
  projects: ProjectInfo[];
  activeProject: string | null;
  activeStatus: ProjectStatus | null;
  loading: boolean;
  loadProjects: () => Promise<void>;
  setActiveProject: (name: string | null) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProject: null,
  activeStatus: null,
  loading: false,

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await api.project.list();
      set({ projects, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setActiveProject: async (name) => {
    set({ activeProject: name, activeStatus: null });
    await api.settings.set({ activeProjectName: name });
    if (name) {
      await get().refreshStatus();
    }
  },

  refreshStatus: async () => {
    const { activeProject } = get();
    if (!activeProject) return;
    try {
      const status = await api.project.getStatus(activeProject);
      set({ activeStatus: status });
    } catch {
      // Status nicht verfügbar
    }
  },
}));
