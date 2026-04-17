import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface ErrorEntry {
  id: string;
  message: string;
  timestamp: number;
}

interface AppState {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  notifications: Notification[];
  errorQueue: ErrorEntry[];
  initialized: boolean;
  online: boolean;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSidebar: () => void;
  addNotification: (type: Notification['type'], message: string) => void;
  dismissNotification: (id: string) => void;
  dismissError: (id: string) => void;
  dismissAllErrors: () => void;
  setInitialized: (v: boolean) => void;
  setOnline: (v: boolean) => void;
}

let notifId = 0;

export const useAppStore = create<AppState>((set) => ({
  theme: 'system',
  sidebarCollapsed: false,
  notifications: [],
  errorQueue: [],
  initialized: false,
  online: navigator.onLine,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  addNotification: (type, message) => {
    const id = String(++notifId);

    if (type === 'error') {
      // Fehler gehen in den Dialog-Queue
      set((s) => ({
        errorQueue: [...s.errorQueue, { id, message, timestamp: Date.now() }],
      }));
    } else {
      // Success/Info bleiben Toasts
      set((s) => ({ notifications: [...s.notifications, { id, type, message }] }));
      setTimeout(() => {
        set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
      }, 5000);
    }
  },

  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  dismissError: (id) =>
    set((s) => ({ errorQueue: s.errorQueue.filter((e) => e.id !== id) })),

  dismissAllErrors: () => set({ errorQueue: [] }),

  setInitialized: (v) => set({ initialized: v }),
  setOnline: (v) => set({ online: v }),
}));
