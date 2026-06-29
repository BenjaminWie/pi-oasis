export interface LocalIngestEvent {
  component: string;
  device?: string;
  status: string;
  message?: string;
  strategy_applied?: string;
  metrics?: Record<string, unknown>;
  ts: string;
  receivedAt: string;
}

const MAX_EVENTS = 500;
const buffer: LocalIngestEvent[] = [];

export function pushLocalIngest(events: LocalIngestEvent[]) {
  buffer.push(...events);
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
}

export function listLocalIngest(limit = 100) {
  return buffer.slice(-Math.max(1, Math.min(500, limit))).reverse();
}