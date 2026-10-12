/**
 * Stand-in for `virtual:pwa-register/react` under Vitest (vite.config.ts `test.alias`): the plugin's virtual module
 * does not load in the test runner. Registers nothing; tests can drive `needRefresh` with `setStubNeedRefresh`.
 */
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

let initialNeedRefresh = false;
export const stubCalls = { update: 0 };

/** The next `useRegisterSW` starts with this `needRefresh` (tests). */
export function setStubNeedRefresh(value: boolean): void {
  initialNeedRefresh = value;
}

export function useRegisterSW(): {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  const needRefresh = useState(initialNeedRefresh);
  const offlineReady = useState(false);
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async () => {
      stubCalls.update++;
    },
  };
}
