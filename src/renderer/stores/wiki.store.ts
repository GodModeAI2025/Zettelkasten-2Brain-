import { create } from 'zustand';
import { api } from '../api/bridge';
import { useProjectStore } from './project.store';

interface WikiState {
  pages: string[];
  activePage: string | null;
  searchQuery: string;
  loading: boolean;

  setPages: (pages: string[]) => void;
  setActivePage: (page: string | null) => void;
  setSearchQuery: (q: string) => void;
  setLoading: (loading: boolean) => void;
  refreshPages: () => Promise<void>;
}

export const useWikiStore = create<WikiState>((set, get) => ({
  pages: [],
  activePage: null,
  searchQuery: '',
  loading: false,

  setPages: (pages) => set({ pages, loading: false }),
  setActivePage: (activePage) => set({ activePage }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (loading) => set({ loading }),

  refreshPages: async () => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) return;
    set({ loading: true });
    try {
      const pages = await api.wiki.listPages(activeProject);
      set({ pages, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
