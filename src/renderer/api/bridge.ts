import type { BridgeApi } from '../../shared/api.types';

declare global {
  interface Window {
    api: BridgeApi;
  }
}

export const api = window.api;
export const hasApi = typeof window.api !== 'undefined';
