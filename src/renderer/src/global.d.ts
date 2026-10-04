import type { VirgilApi } from '../../preload/index';

declare global {
  interface Window {
    virgil: VirgilApi;
  }
}

export {};
