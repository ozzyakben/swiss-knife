"use client";

import { useSyncExternalStore } from "react";

// The platform never changes mid-session — no subscription needed.
const subscribe = () => () => {};
const clientSnapshot = () => /Mac/.test(navigator.platform);
// SSR default: Mac (this app's primary target). React swaps in the client
// snapshot after hydration, so non-Mac browsers correct without a mismatch.
const serverSnapshot = () => true;

/**
 * Platform detection that is HYDRATION-SAFE. `navigator` doesn't exist on the
 * server, so deciding ⌘ vs Ctrl during render made the server text differ from
 * a Mac client's first paint — the React #418 mismatch the dashboard shipped
 * with. useSyncExternalStore renders the server snapshot through hydration,
 * then the real platform.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
