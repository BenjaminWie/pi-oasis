// Detects whether the server function is executing on a Raspberry Pi (or any
// Linux host with a Docker daemon). When this returns false — e.g. running in
// the Cloudflare Worker that serves the marketing landing, or `vite dev` on a
// laptop with no Docker — server functions fall back to mock data so the demo
// still works.
//
// IMPORTANT: only import this from inside a `.handler()` body, never at
// module scope of a `.functions.ts` file (that would pull `fs` into the
// Worker bundle).

import { existsSync, statSync } from "node:fs";

let cached: boolean | null = null;

export function isPiRuntime(): boolean {
  if (cached !== null) return cached;
  try {
    const hasProc = existsSync("/proc/stat") && existsSync("/proc/meminfo");
    let hasDocker = false;
    try {
      const s = statSync("/var/run/docker.sock");
      hasDocker = s.isSocket();
    } catch {
      hasDocker = false;
    }
    cached = hasProc && hasDocker;
  } catch {
    cached = false;
  }
  return cached;
}

export function hasProcStats(): boolean {
  try {
    return existsSync("/proc/stat") && existsSync("/proc/meminfo");
  } catch {
    return false;
  }
}
