import { createServerFn } from "@tanstack/react-start";
import { mockStats, mockContainers, mockLogs } from "./mock-data";

// NOTE: On the Pi, replace these mock returns with:
//   - dockerode for container list/actions/logs
//   - /proc/stat, /proc/meminfo, statvfs() for system stats
//   - vcgencmd measure_temp for SoC temp
// The shape returned here is the contract — keep it stable.

export const getSystemStats = createServerFn({ method: "GET" }).handler(async () => {
  // jitter so the UI feels alive in preview
  const j = (n: number, d: number) => Math.max(0, Math.round((n + (Math.random() - 0.5) * d) * 10) / 10);
  return {
    ...mockStats,
    cpu: j(mockStats.cpu, 8),
    ramUsedGb: j(mockStats.ramUsedGb, 0.3),
    tempC: j(mockStats.tempC, 2),
  };
});

export const listContainers = createServerFn({ method: "GET" }).handler(async () => {
  return mockContainers;
});

export const getContainer = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const c = mockContainers.find((x) => x.id === data.id);
    if (!c) return null;
    return { ...c, logs: mockLogs(c.name) };
  });

export const containerAction = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; action: "start" | "stop" | "restart" }) => d)
  .handler(async ({ data }) => {
    // On Pi: docker.getContainer(data.id)[data.action]()
    return { ok: true, id: data.id, action: data.action };
  });
