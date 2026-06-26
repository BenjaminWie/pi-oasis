// Real MQTT client + a small in-memory ring buffer per (broker, filter) so the
// UI's ~1s polling shows a continuous stream without us holding a connection
// open for every poll request.
//
// Loaded only on the Pi (gated by isPiRuntime in the .functions.ts).

import mqtt, { type MqttClient } from "mqtt";
import type { MqttMessage } from "../core/mock-data";

interface Subscription {
  client: MqttClient;
  buf: MqttMessage[];
  lastSeen: number;
}

const subs = new Map<string, Subscription>();
const MAX_BUF = 200;
const IDLE_MS = 60_000;

function key(brokerId: string, filter: string) {
  return `${brokerId}::${filter}`;
}

async function resolveBrokerUrl(brokerId: string): Promise<string> {
  const { listRealContainers } = await import("@/lib/system/system.server");
  const cs = await listRealContainers();
  const c = cs.find((x) => x.id === brokerId || x.id.startsWith(brokerId));
  if (!c) throw new Error(`broker ${brokerId} not found`);
  const port = c.ports.find((p) => p === "1883") ?? c.ports[0] ?? "1883";
  // localhost works when the broker is published to the host. Most Pi setups
  // run `-p 1883:1883`, which is exactly this case.
  return `mqtt://127.0.0.1:${port}`;
}

async function ensureSub(brokerId: string, filter: string): Promise<Subscription> {
  const k = key(brokerId, filter);
  const existing = subs.get(k);
  if (existing) {
    existing.lastSeen = Date.now();
    return existing;
  }
  const url = await resolveBrokerUrl(brokerId);
  const client = mqtt.connect(url, {
    clientId: `pi-hub-${Math.random().toString(36).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 4000,
  });
  const sub: Subscription = { client, buf: [], lastSeen: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mqtt connect timeout")), 4500);
    client.once("connect", () => {
      clearTimeout(t);
      client.subscribe(filter, { qos: 0 }, (err) => (err ? reject(err) : resolve()));
    });
    client.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
  client.on("message", (topic, payload, packet) => {
    sub.buf.push({
      id: Math.random().toString(36).slice(2, 10),
      ts: Date.now(),
      topic,
      payload: payload.toString("utf8"),
      qos: (packet.qos ?? 0) as 0 | 1 | 2,
      retained: !!packet.retain,
    });
    if (sub.buf.length > MAX_BUF) sub.buf.splice(0, sub.buf.length - MAX_BUF);
  });
  subs.set(k, sub);
  return sub;
}

// reap idle subscriptions
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of subs) {
    if (now - s.lastSeen > IDLE_MS) {
      try {
        s.client.end(true);
      } catch {
        /* ignore */
      }
      subs.delete(k);
    }
  }
}, 15_000).unref?.();

export async function drainMqtt(brokerId: string, filter: string): Promise<MqttMessage[]> {
  const sub = await ensureSub(brokerId, filter);
  const out = sub.buf;
  sub.buf = [];
  sub.lastSeen = Date.now();
  return out;
}

export async function publishMqtt(
  brokerId: string,
  msg: { topic: string; payload: string; qos: 0 | 1 | 2; retained: boolean },
): Promise<void> {
  const url = await resolveBrokerUrl(brokerId);
  const client = mqtt.connect(url, {
    clientId: `pi-hub-pub-${Math.random().toString(36).slice(2, 10)}`,
    reconnectPeriod: 0,
    connectTimeout: 4000,
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mqtt connect timeout")), 4500);
    client.once("connect", () => {
      clearTimeout(t);
      client.publish(msg.topic, msg.payload, { qos: msg.qos, retain: msg.retained }, (err) => {
        client.end(true);
        err ? reject(err) : resolve();
      });
    });
    client.once("error", (e) => {
      clearTimeout(t);
      try {
        client.end(true);
      } catch {
        /* ignore */
      }
      reject(e);
    });
  });
}
