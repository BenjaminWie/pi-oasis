import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";
import {
  generateMockMqttMessage,
  mockContainers,
  type MqttMessage,
} from "./mock-data";

// NOTE: On the Pi, replace these with a real `mqtt.js` client connecting to
// the detected broker container (e.g. mqtt://<bridge-ip>:1883). The contract
// shape (MqttMessage) stays identical so the UI doesn't change.

export const listMqttBrokers = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
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

/** Returns a small batch of new mock messages each poll. Real impl streams via WS. */
export const pollMqttMessages = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .inputValidator((d: { brokerId: string; topicFilter?: string }) => d)
  .handler(async ({ data }): Promise<{ messages: MqttMessage[] }> => {
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
  .inputValidator(
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
    return { ok: true, echo: data };
  });
