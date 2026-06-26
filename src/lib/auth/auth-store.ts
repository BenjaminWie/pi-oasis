// Tiny client-side auth store using localStorage. Mirrors what the cookie does on the Pi.
import { useSyncExternalStore } from "react";

const KEY = "pi-dashboard.token";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const auth = {
  get token(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(KEY);
  },
  get isAuthenticated() {
    return !!auth.token;
  },
  setToken(t: string) {
    window.localStorage.setItem(KEY, t);
    emit();
  },
  clear() {
    window.localStorage.removeItem(KEY);
    emit();
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function useAuth() {
  return useSyncExternalStore(
    auth.subscribe,
    () => auth.isAuthenticated,
    () => false,
  );
}
