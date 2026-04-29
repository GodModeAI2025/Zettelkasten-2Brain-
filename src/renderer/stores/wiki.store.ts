import { create } from 'zustand';
import { api } from '../api/bridge';
import { useProjectStore } from './project.store';
import type { WikiReviewItem } from '../../shared/api.types';

interface WikiState {
  pages: string[];
  reviewQueue: WikiReviewItem[];
  activePage: string | null;
  searchQuery: string;
  loading: boolean;
  reviewLoading: boolean;

  setPages: (pages: string[]) => void;
  setReviewQueue: (reviewQueue: WikiReviewItem[]) => void;
  setActivePage: (page: string | null) => void;
  setSearchQuery: (q: string) => void;
  setLoading: (loading: boolean) => void;
  refreshPages: () => Promise<void>;
  refreshReviewQueue: () => Promise<void>;
}

export const useWikiStore = create<WikiState>((set) => ({
  pages: [],
  reviewQueue: [],
  activePage: null,
  searchQuery: '',
  loading: false,
  reviewLoading: false,

  setPages: (pages) => set({ pages, loading: false }),
  setReviewQueue: (reviewQueue) => set({ reviewQueue, reviewLoading: false }),
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

  refreshReviewQueue: async () => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) {
      set({ reviewQueue: [], reviewLoading: false });
      return;
    }
    set({ reviewLoading: true });
    try {
      const reviewQueue = await api.wiki.listReviewQueue(activeProject);
      set({ reviewQueue, reviewLoading: false });
    } catch {
      set({ reviewQueue: [], reviewLoading: false });
    }
  },
}));
