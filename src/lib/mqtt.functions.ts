import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";
import { generateMockMqttMessage, mockContainers, type MqttMessage } from "./mock-data";

// On the Pi, real broker discovery comes from the Docker socket and the
// poll/publish endpoints open short-lived `mqtt://` connections. On the
// Cloudflare Worker (landing page demo), everything falls through to mock
// data — the marketing site stays self-contained.

export const listMqttBrokers = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { isPiRuntime } = await import("./pi-runtime.server");
    if (isPiRuntime()) {
      try {
        const { listRealContainers } = await import("./system.server");
        const cs = await listRealContainers();
        return cs
          .filter(
            (c) =>
              c.isMqtt ||
              /mosquitto|emqx|hivemq|nanomq|vernemq/i.test(c.image) ||
              c.ports.includes("1883") ||
              c.ports.includes("8883"),
          )
          .map((c) => ({
            id: c.id,
            name: c.name,
            image: c.image,
            status: c.status,
            port: c.ports.find((p) => p === "1883" || p === "8883") ?? "1883",
          }));
      } catch {
        /* fall through to mock */
      }
    }
    return mockContainers
      .filter(
        (c) =>
          c.isMqtt ||
          /mosquitto|emqx|hivemq|nanomq|vernemq/i.test(c.image) ||
          c.ports.some((p) => p === "1883" || p === "8883"),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        image: c.image,
        status: c.status,
        port: c.ports[0] ?? "1883",
      }));
  });

export const pollMqttMessages = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .validator((d: { brokerId: string; topicFilter?: string }) => d)
  .handler(async ({ data }): Promise<{ messages: MqttMessage[] }> => {
    const { isPiRuntime } = await import("./pi-runtime.server");
    if (isPiRuntime()) {
      try {
        const { drainMqtt } = await import("./mqtt.server");
        const messages = await drainMqtt(data.brokerId, data.topicFilter ?? "#");
        return { messages };
      } catch {
        return { messages: [] };
      }
    }
    // mock demo stream
    const broker = mockContainers.find((c) => c.id === data.brokerId);
    if (!broker || broker.status !== "running") return { messages: [] };
    const count = 1 + Math.floor(Math.random() * 3);
    const messages: MqttMessage[] = [];
    for (let i = 0; i < count; i++) {
      const m = generateMockMqttMessage();
      if (
        data.topicFilter &&
        data.topicFilter !== "#" &&
        !m.topic.includes(data.topicFilter.replace(/[#+]/g, ""))
      )
        continue;
      messages.push(m);
    }
    return { messages };
  });

export const publishMqttMessage = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .validator(
    (d: {
      brokerId: string;
      topic: string;
      payload: string;
      qos?: 0 | 1 | 2;
      retained?: boolean;
    }) => {
      if (typeof d.topic !== "string" || d.topic.length === 0 || d.topic.length > 512) {
        throw new Error("invalid topic");
      }
      if (typeof d.payload !== "string" || d.payload.length > 64 * 1024) {
        throw new Error("invalid payload");
      }
      if (d.qos != null && ![0, 1, 2].includes(d.qos)) throw new Error("invalid qos");
      return d;
    },
  )
  .handler(async ({ data }) => {
    const { isPiRuntime } = await import("./pi-runtime.server");
    if (isPiRuntime()) {
      try {
        const { publishMqtt } = await import("./mqtt.server");
        await publishMqtt(data.brokerId, {
          topic: data.topic,
          payload: data.payload,
          qos: data.qos ?? 0,
          retained: data.retained ?? false,
        });
        return { ok: true, echo: data };
      } catch (e) {
        return { ok: false, echo: data, error: (e as Error).message };
      }
    }
    return { ok: true, echo: data };
  });
