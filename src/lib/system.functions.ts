import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";
import {
  mockStats,
  mockContainers,
  mockLogs,
  type ContainerStatus,
  type ContainerSummary,
  type SystemStats,
} from "./mock-data";

// All real-system reads live in a sibling `.server.ts` module and are loaded
// dynamically inside each handler. That keeps `dockerode`, `fs`, and
// `child_process` out of the Cloudflare Worker bundle that serves the landing
// page — those handlers fall through to mock data on the Worker.

export const getSystemStats = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async (): Promise<SystemStats> => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) return jitterMock();
    try {
      const { readRealSystemStats } = await import("./system.server");
      return await readRealSystemStats();
    } catch {
      return jitterMock();
    }
  });

export const listContainers = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async (): Promise<ContainerSummary[]> => {
    const { isPiRuntime } = await import("./pi-runtime.server");
    if (!isPiRuntime()) return mockContainers;
    try {
      const { listRealContainers } = await import("./system.server");
      return await listRealContainers();
    } catch {
      return mockContainers;
    }
  });

export const getContainer = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { isPiRuntime } = await import("./pi-runtime.server");
    if (!isPiRuntime()) {
      const c = mockContainers.find((x) => x.id === data.id);
      if (!c) return null;
      return { ...c, logs: mockLogs(c.name) };
    }
    try {
      const { getRealContainer } = await import("./system.server");
      return await getRealContainer(data.id);
    } catch {
      const c = mockContainers.find((x) => x.id === data.id);
      if (!c) return null;
      return { ...c, logs: mockLogs(c.name) };
    }
  });

export const containerAction = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator(
    (d: { id: string; action: "start" | "stop" | "restart" }) => d,
  )
  .handler(async ({ data }) => {
    const { isPiRuntime } = await import("./pi-runtime.server");
    if (!isPiRuntime()) return { ok: true, id: data.id, action: data.action };
    try {
      const { runContainerAction } = await import("./system.server");
      await runContainerAction(data.id, data.action);
      return { ok: true, id: data.id, action: data.action };
    } catch (e) {
      return {
        ok: false,
        id: data.id,
        action: data.action,
        error: (e as Error).message,
      };
    }
  });

function jitterMock(): SystemStats {
  const j = (n: number, d: number) =>
    Math.max(0, Math.round((n + (Math.random() - 0.5) * d) * 10) / 10);
  return {
    ...mockStats,
    cpu: j(mockStats.cpu, 8),
    ramUsedGb: j(mockStats.ramUsedGb, 0.3),
    tempC: j(mockStats.tempC, 2),
  };
}

// re-export types so callers don't need to know about mock-data
export type { ContainerSummary, ContainerStatus, SystemStats };
