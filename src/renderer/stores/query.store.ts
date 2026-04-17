import { create } from 'zustand';

interface QueryStore {
  pendingQuestion: string | null;
  setPendingQuestion: (q: string | null) => void;
  consumePendingQuestion: () => string | null;
}

export const useQueryStore = create<QueryStore>((set, get) => ({
  pendingQuestion: null,
  setPendingQuestion: (q) => set({ pendingQuestion: q }),
  consumePendingQuestion: () => {
    const q = get().pendingQuestion;
    if (q !== null) set({ pendingQuestion: null });
    return q;
  },
}));
