import { create } from 'zustand';

export interface TakeawayMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TakeawayStore {
  conversations: Record<string, TakeawayMessage[]>;
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  getConversation: (key: string) => TakeawayMessage[];
  addMessage: (key: string, message: TakeawayMessage) => void;
  clearConversation: (key: string) => void;
}

export const useTakeawayStore = create<TakeawayStore>((set, get) => ({
  conversations: {},
  openKey: null,
  setOpenKey: (key) => set({ openKey: key }),
  getConversation: (key) => get().conversations[key] || [],
  addMessage: (key, message) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [key]: [...(state.conversations[key] || []), message],
      },
    })),
  clearConversation: (key) =>
    set((state) => {
      const next = { ...state.conversations };
      delete next[key];
      return { conversations: next };
    }),
}));
