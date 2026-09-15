// Single source of truth for everything a Node-RED flow needs to talk to this
// Pi. Pi Control is local-first: Node-RED never talks to the cloud, it only
// announces its endpoints here and streams values into the local store.
import { networkInterfaces } from "node:os";

export interface NodeRedConfig {
  generatedAt: string;
  device: { label: string };
  local: {
    baseUrl: string;
    configUrl: string;
    announceUrl: string;
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

export async function buildNodeRedConfig(): Promise<NodeRedConfig> {
  const port = Number(process.env.PORT || 3000);
  const host = lanIp() || "127.0.0.1";
  const localBase = `http://${host}:${port}`;
  const localToken = process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || null;

  return {
    generatedAt: new Date().toISOString(),
    device: { label: process.env.DEFAULT_DEVICE_LABEL || "pi-control" },
    local: {
      baseUrl: localBase,
      configUrl: `${localBase}/api/public/nodered/config`,
      announceUrl: `${localBase}/api/public/nodered/announce`,
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
