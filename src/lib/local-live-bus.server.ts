// In-process pub/sub so locally ingested ticks/events/traces reach every open
// browser tab of the Pi dashboard instantly (delivered via SSE).
// Server-only, no database, no network.

export type LocalBusEvent = "tick" | "event" | "trace" | "decision";

type Listener = (e: LocalBusEvent, payload: unknown) => void;

const listeners = new Set<Listener>();

export function subscribeLocalBus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publishLocalBus(e: LocalBusEvent, payload: unknown): void {
  for (const fn of listeners) {
    try {
      fn(e, payload);
    } catch {
      /* a broken client must not break the others */
    }
  }
}

export function localBusClientCount(): number {
  return listeners.size;
}
