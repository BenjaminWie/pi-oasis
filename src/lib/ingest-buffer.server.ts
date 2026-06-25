// In-memory ring buffer for inbound device events (e.g. Node-RED pump_monitor).
// ZERO disk writes — the buffer is plain RAM, capped at MAX_BUFFER entries.
// Forwarder uses the existing cloud-bridge config to push events to the cloud.
//
// Lifecycle: pushEvent() is called from the loopback /api/public/ingest/event
// route. It synchronously appends + trims the buffer, then schedules an async
// fire-and-forget cloud forward. The forwarder maintains its own bounded queue
// (also in RAM) so a brief cloud outage doesn't lose events; on overflow we
// drop the oldest and bump `dropped`.

export interface IngestEvent {
  id: number;
  component: string;
  device: string;
  status: "healthy" | "warning" | "critical" | "info";
  timestamp: string;
  metrics: Record<string, unknown>;
  receivedAt: string;
  forward: "pending" | "ok" | "skipped" | "failed";
}

const MAX_BUFFER = 200;
const MAX_FORWARD_QUEUE = 50;

let nextId = 1;
const buffer: IngestEvent[] = [];
const forwardQueue: IngestEvent[] = [];
let forwarding = false;
let droppedForward = 0;
let forwardedOk = 0;

export function pushEvent(input: {
  component: string;
  device: string;
  status: IngestEvent["status"];
  timestamp: string;
  metrics: Record<string, unknown>;
}): IngestEvent {
  const ev: IngestEvent = {
    id: nextId++,
    component: input.component,
    device: input.device,
    status: input.status,
    timestamp: input.timestamp,
    metrics: input.metrics,
    receivedAt: new Date().toISOString(),
    forward: "pending",
  };
  buffer.push(ev);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  scheduleForward(ev);
  return ev;
}

export function getRecentEvents(sinceId = 0): {
  events: IngestEvent[];
  cursor: number;
  stats: { buffered: number; forwarded: number; queued: number; dropped: number };
} {
  const events = buffer.filter((e) => e.id > sinceId);
  return {
    events,
    cursor: buffer.length ? buffer[buffer.length - 1].id : sinceId,
    stats: {
      buffered: buffer.length,
      forwarded: forwardedOk,
      queued: forwardQueue.length,
      dropped: droppedForward,
    },
  };
}

function scheduleForward(ev: IngestEvent) {
  forwardQueue.push(ev);
  if (forwardQueue.length > MAX_FORWARD_QUEUE) {
    const dropped = forwardQueue.splice(0, forwardQueue.length - MAX_FORWARD_QUEUE);
    droppedForward += dropped.length;
    for (const d of dropped) d.forward = "failed";
  }
  if (!forwarding) {
    forwarding = true;
    void drainForward();
  }
}

async function drainForward() {
  try {
    const { getCloudConfig } = await import("./pin-store.server");
    while (forwardQueue.length) {
      const cfg = await getCloudConfig();
      if (!cfg) {
        // No cloud paired — mark all queued as skipped, keep them in buffer
        // (the UI still shows them locally).
        for (const ev of forwardQueue) ev.forward = "skipped";
        forwardQueue.length = 0;
        return;
      }
      const ev = forwardQueue[0];
      try {
        const r = await fetch(cfg.cloudUrl + "/api/public/cloud-bridge/event", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.deviceToken}`,
          },
          body: JSON.stringify({
            component: ev.component,
            device: ev.device,
            status: ev.status,
            timestamp: ev.timestamp,
            metrics: ev.metrics,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) {
          ev.forward = "ok";
          forwardedOk++;
          forwardQueue.shift();
        } else {
          // Transient: back off, keep at head
          await sleep(2000);
          // If repeatedly failing we'll eventually overflow & drop oldest.
          forwardQueue.shift();
          forwardQueue.push(ev);
          ev.forward = "failed";
          if (forwardQueue.length > MAX_FORWARD_QUEUE) {
            const dropped = forwardQueue.splice(0, forwardQueue.length - MAX_FORWARD_QUEUE);
            droppedForward += dropped.length;
          }
          await sleep(1000);
        }
      } catch {
        await sleep(3000);
        forwardQueue.shift();
        forwardQueue.push(ev);
        ev.forward = "failed";
        if (forwardQueue.length > MAX_FORWARD_QUEUE) {
          const dropped = forwardQueue.splice(0, forwardQueue.length - MAX_FORWARD_QUEUE);
          droppedForward += dropped.length;
        }
      }
    }
  } finally {
    forwarding = false;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
