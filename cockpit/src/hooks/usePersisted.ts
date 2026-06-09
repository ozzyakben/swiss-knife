"use client";

import { useSyncExternalStore } from "react";

// localStorage-backed string state read via useSyncExternalStore — SSR-safe
// (the server snapshot is the fallback, so first paint matches SSR and the
// stored value arrives with hydration; no mismatch, no setState-in-effect).
// Same-tab updates re-render via the custom "sk:storage" event; cross-tab via
// the native "storage" event. Values are plain strings — JSON-encode richer
// shapes at the call site (see SidebarNav favorites).
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener("sk:storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("sk:storage", cb);
  };
}

export function usePersisted(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback
  );
  const setValue = (v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* storage full/blocked — state simply won't persist */
    }
    window.dispatchEvent(new Event("sk:storage"));
  };
  return [value, setValue];
}
