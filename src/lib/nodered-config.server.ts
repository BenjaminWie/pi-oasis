// Single source of truth for everything a Node-RED flow needs to talk to this
// Pi and to the cloud. The Pi is the only place that knows the device token,
// device id, LAN ip and port — so Node-RED fetches config from here instead of
// having the values pasted into tab env by hand.
import { networkInterfaces } from "node:os";

export interface NodeRedConfig {
  generatedAt: string;
  device: { label: string; name: string | null; paired: boolean };
  cloud: {
    baseUrl: string;
    eventUrl: string;
    strategyUrl: string;
    liveUrl: string;
    commandPollUrl: string;
    commandResultUrl: string;
    realtimeBootstrapUrl: string;
    deviceToken: string | null;
    deviceId: string | null;
    wsUrl: string | null;
    channel: string | null;
  };
  local: {
    baseUrl: string;
    configUrl: string;
    eventUrl: string;
    liveUrl: string;
    traceUrl: string;
    token: string | null;
  };
  mqtt: { commandTopic: string; brokerHost: string; brokerPort: number };
}

export function lanIp(): string | null {
  try {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] ?? []) {
        if (ni.family !== "IPv4" || ni.internal) continue;
        if (
          ni.address.startsWith("192.168.") ||
          ni.address.startsWith("10.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(ni.address)
        ) {
          return ni.address;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

let realtimeCache: {
  at: number;
  token: string;
  data: { wsUrl: string | null; deviceId: string | null; channel: string | null };
} | null = null;

/** Resolve the Supabase realtime websocket URL once and cache it for an hour. */
async function resolveRealtime(cloudUrl: string, token: string) {
  if (realtimeCache && realtimeCache.token === token && Date.now() - realtimeCache.at < 3_600_000) {
    return realtimeCache.data;
  }
  const empty = { wsUrl: null, deviceId: null, channel: null };
  try {
    const res = await fetch(`${cloudUrl}/api/public/agent/realtime`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return empty;
    const b = (await res.json()) as {
      supabaseUrl?: string;
      supabaseKey?: string;
      deviceId?: string;
      channel?: string;
    };
    if (!b.supabaseUrl || !b.supabaseKey || !b.deviceId) return empty;
    const data = {
      wsUrl: `${b.supabaseUrl.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${b.supabaseKey}&vsn=1.0.0`,
      deviceId: b.deviceId,
      channel: b.channel || `commands:${b.deviceId}`,
    };
    realtimeCache = { at: Date.now(), token, data };
    return data;
  } catch {
    return empty;
  }
}

export async function buildNodeRedConfig(): Promise<NodeRedConfig> {
  const cloudUrl = (process.env.VITE_PI_HUB_CLOUD_URL || "https://pi-hub.benniwie.com").replace(
    /\/$/,
    "",
  );
  const port = Number(process.env.PORT || 3000);
  const host = lanIp() || "127.0.0.1";
  const localBase = `http://${host}:${port}`;
  const localToken = process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || null;

  let deviceToken: string | null = null;
  let deviceName: string | null = null;
  let deviceId: string | null = null;
  try {
    const { getCloudConfig } = await import("./pin-store.server");
    const cfg = await getCloudConfig();
    deviceToken = cfg?.deviceToken ?? null;
    deviceName = cfg?.name ?? null;
    deviceId = cfg?.deviceId ?? null;
  } catch {
    /* not paired */
  }

  const rt = deviceToken
    ? await resolveRealtime(cloudUrl, deviceToken)
    : { wsUrl: null, deviceId: null, channel: null };

  return {
    generatedAt: new Date().toISOString(),
    device: {
      label: process.env.DEFAULT_DEVICE_LABEL || "drainpress",
      name: deviceName,
      paired: !!deviceToken,
    },
    cloud: {
      baseUrl: cloudUrl,
      eventUrl: `${cloudUrl}/api/public/cloud-bridge/event`,
      strategyUrl: `${cloudUrl}/api/public/cloud-bridge/strategy`,
      liveUrl: `${cloudUrl}/api/public/live/publish`,
      commandPollUrl: `${cloudUrl}/api/public/agent/poll?runner=nodered`,
      commandResultUrl: `${cloudUrl}/api/public/agent/result`,
      realtimeBootstrapUrl: `${cloudUrl}/api/public/agent/realtime`,
      deviceToken,
      deviceId: rt.deviceId || deviceId,
      wsUrl: rt.wsUrl,
      channel: rt.channel,
    },
    local: {
      baseUrl: localBase,
      configUrl: `${localBase}/api/public/nodered/config`,
      eventUrl: `${localBase}/api/public/ingest/event`,
      liveUrl: `${localBase}/api/public/ingest/live`,
      traceUrl: `${localBase}/api/public/ingest/trace`,
      token: localToken,
    },
    mqtt: {
      commandTopic: process.env.MQTT_COMMAND_TOPIC || "cmnd/zisterne/POWER",
      brokerHost: process.env.MQTT_BROKER_HOST || "127.0.0.1",
      brokerPort: Number(process.env.MQTT_BROKER_PORT || 1883),
    },
  };
}
