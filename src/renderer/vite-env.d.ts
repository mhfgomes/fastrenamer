/// <reference types="vite/client" />

import type { AdvancedRenamerApi } from '@shared/contracts';

declare global {
  const __APP_VERSION__: string;

  interface Window {
    advancedRenamer: AdvancedRenamerApi;
  }
}

export {};
