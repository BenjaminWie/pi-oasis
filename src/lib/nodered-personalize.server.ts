// Renders public/nodered-template.json with this Pi's real values baked in:
// tab env (local URLs + ingest token) and the MQTT broker address. The user
// imports the result and hits Deploy — nothing to paste by hand.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeRedConfig } from "./nodered-config.server";

type Node = Record<string, unknown>;

async function loadTemplate(localBase: string): Promise<Node[]> {
  const candidates = [
    join(process.cwd(), "public", "nodered-template.json"),
    join(process.cwd(), ".output", "public", "nodered-template.json"),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(await readFile(p, "utf8")) as Node[];
    } catch {
      /* try next */
    }
  }
  const res = await fetch(`${localBase}/nodered-template.json`);
  if (!res.ok) throw new Error("template not found");
  return (await res.json()) as Node[];
}

export async function renderPersonalizedFlow(cfg: NodeRedConfig): Promise<string> {
  const nodes = await loadTemplate(cfg.local.baseUrl);

  const envMap: Record<string, string> = {
    LOCAL_BASE_URL: cfg.local.baseUrl,
    LOCAL_CONFIG_URL: cfg.local.configUrl,
    LOCAL_ANNOUNCE_URL: cfg.local.announceUrl,
    LOCAL_LIVE_URL: cfg.local.liveUrl,
    LOCAL_EVENT_URL: cfg.local.eventUrl,
    LOCAL_TRACE_URL: cfg.local.traceUrl,
    PI_INGEST_TOKEN: cfg.local.token ?? "",
    DEFAULT_DEVICE_LABEL: cfg.device.label,
    MQTT_COMMAND_TOPIC: cfg.mqtt.commandTopic,
    MQTT_BROKER_HOST: cfg.mqtt.brokerHost,
    MQTT_BROKER_PORT: String(cfg.mqtt.brokerPort),
  };

  for (const n of nodes) {
    if (n["type"] === "tab") {
      const existing =
        (n["env"] as { name: string; type: string; value: string }[] | undefined) ?? [];
      const byName = new Map(existing.map((e) => [e.name, e]));
      for (const [name, value] of Object.entries(envMap)) {
        byName.set(name, { name, type: "str", value });
      }
      n["env"] = [...byName.values()];
    }
    if (n["type"] === "mqtt-broker") {
      n["broker"] = cfg.mqtt.brokerHost;
      n["port"] = String(cfg.mqtt.brokerPort);
    }
  }

  return JSON.stringify(nodes, null, 2);
}
