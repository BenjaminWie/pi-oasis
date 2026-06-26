import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "../auth/pi-auth-middleware";

export interface HostInfo {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  nodeVersion: string;
  dashboardVersion: string;
  isPi: boolean;
  trustedDevices: Array<{ id: string; label: string; lastSeenAt: string }>;
  cloudBridge: { connected: boolean; deviceName?: string; cloudUrl?: string } | null;
}

export const getHostInfo = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async (): Promise<HostInfo> => {
    const os = await import("node:os");
    const { hasProcStats } = await import("@/lib/core/pi-runtime.server");
    const isPi = hasProcStats();
    let trustedDevices: HostInfo["trustedDevices"] = [];
    let cloudBridge: HostInfo["cloudBridge"] = null;
    if (isPi) {
      const { listTrustedDevices, getCloudConfig } = await import("@/lib/auth/pin-store.server");
      const td = await listTrustedDevices();
      trustedDevices = td.map((t) => ({ id: t.id, label: t.label, lastSeenAt: t.lastSeenAt }));
      const cfg = await getCloudConfig();
      cloudBridge = cfg
        ? { connected: true, deviceName: cfg.name, cloudUrl: cfg.cloudUrl }
        : { connected: false };
    }
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      nodeVersion: process.version,
      dashboardVersion: process.env.npm_package_version || "pi-hub",
      isPi,
      trustedDevices,
      cloudBridge,
    };
  });

export const revokeTrustedDevices = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("@/lib/core/pi-runtime.server");
    if (!hasProcStats()) return { ok: false as const };
    const { revokeAllTrustedDevices } = await import("@/lib/auth/pin-store.server");
    await revokeAllTrustedDevices();
    return { ok: true as const };
  });

export const getFactoryTokenForDisplay = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("@/lib/core/pi-runtime.server");
    if (!hasProcStats()) return { token: null as string | null };
    const { getFactoryToken } = await import("@/lib/auth/pin-store.server");
    return { token: await getFactoryToken() };
  });
