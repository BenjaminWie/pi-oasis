// Renders public/nodered-template.json with this Pi's real values baked in:
// tab env (tokens, URLs), the websocket-client path, and the MQTT broker.
// That removes the chicken-and-egg problem where the WS URL is only known
// after a bootstrap request but must be static in the config node.
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
  let nodes = await loadTemplate(cfg.local.baseUrl);

  const envMap: Record<string, string> = {
    CLOUD_BRIDGE_URL: cfg.cloud.eventUrl,
    CLOUD_STRATEGY_URL: cfg.cloud.strategyUrl,
    CLOUD_LIVE_URL: cfg.cloud.liveUrl,
    CLOUD_COMMAND_POLL_URL: cfg.cloud.commandPollUrl,
    CLOUD_COMMAND_RESULT_URL: cfg.cloud.commandResultUrl,
    CLOUD_REALTIME_BOOTSTRAP_URL: cfg.cloud.realtimeBootstrapUrl,
    CLOUD_DEVICE_TOKEN: cfg.cloud.deviceToken ?? "",
    CLOUD_DEVICE_ID: cfg.cloud.deviceId ?? "",
    CLOUD_WS_URL: cfg.cloud.wsUrl ?? "",
    LOCAL_BASE_URL: cfg.local.baseUrl,
    LOCAL_CONFIG_URL: cfg.local.configUrl,
    LOCAL_API_URL: cfg.local.eventUrl,
    PI_INGEST_TOKEN: cfg.local.token ?? "",
    LOCAL_SINK: "on",
    DEFAULT_DEVICE_LABEL: cfg.device.label,
    MQTT_COMMAND_TOPIC: cfg.mqtt.commandTopic,
    MQTT_BROKER_HOST: cfg.mqtt.brokerHost,
    MQTT_BROKER_PORT: String(cfg.mqtt.brokerPort),
    TRACE_MODE: "errors",
  };

  for (const n of nodes) {
    if (n["type"] === "tab") {
      const existing = (n["env"] as { name: string; type: string; value: string }[] | undefined) ?? [];
      const byName = new Map(existing.map((e) => [e.name, e]));
      for (const [name, value] of Object.entries(envMap)) {
        byName.set(name, { name, type: "str", value });
      }
      n["env"] = [...byName.values()];
    }
    if (n["type"] === "websocket-client" && cfg.cloud.wsUrl) {
      n["path"] = cfg.cloud.wsUrl;
    }
    if (n["type"] === "mqtt-broker") {
      n["broker"] = cfg.mqtt.brokerHost;
      n["port"] = String(cfg.mqtt.brokerPort);
    }
  }

  // A websocket-client with an empty path reconnects forever in Node-RED. If
  // cloud bootstrap is unavailable, export a deliberately local-first flow
  // and leave the 15-minute HTTP safety poll in place.
  if (!cfg.cloud.wsUrl) {
    const websocketNodeIds = new Set([
      "pihub_ws_comment",
      "pihub_ws_bootstrap_tick",
      "pihub_ws_build_bootstrap",
      "pihub_ws_http_bootstrap",
      "pihub_ws_store_bootstrap",
      "pihub_ws_client",
      "pihub_ws_in",
      "pihub_ws_out",
      "pihub_ws_join_tick",
      "pihub_ws_join",
      "pihub_ws_parse",
      "pihub_ws_status",
      "pihub_ws_status_fn",
    ]);
    nodes = nodes
      .filter((node) => !websocketNodeIds.has(String(node["id"] ?? "")))
      .map((node) => {
        const wires = node["wires"];
        if (Array.isArray(wires)) {
          node["wires"] = wires.map((port) =>
            Array.isArray(port) ? port.filter((id) => !websocketNodeIds.has(String(id))) : port,
          );
        }
        const scope = node["scope"];
        if (Array.isArray(scope)) {
          node["scope"] = scope.filter((id) => !websocketNodeIds.has(String(id)));
        }
        return node;
      });
  }

  return JSON.stringify(nodes, null, 2);
}
