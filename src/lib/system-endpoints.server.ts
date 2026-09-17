// Pi Control reports its own system values into the endpoint registry, so the
// "System" group works without any Node-RED node. Cheap: one read per minute,
// only while the process is running on a real Pi/Linux host.
import { setEndpointValue, announceEndpoints, debugLogVerbose } from "./registry.server";

let timer: ReturnType<typeof setInterval> | null = null;
let announced = false;

const SYS = [
  { id: "sys_cpu_pct", label: "CPU", unit: "%", group: "System" },
  { id: "sys_mem_pct", label: "Arbeitsspeicher", unit: "%", group: "System" },
  { id: "sys_disk_pct", label: "Speicherplatz", unit: "%", group: "System" },
  { id: "sys_temp_c", label: "Temperatur", unit: "°C", group: "System" },
  { id: "sys_uptime_h", label: "Laufzeit", unit: "h", group: "System" },
] as const;

export async function reportSystemEndpoints(): Promise<void> {
  try {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) return;
    const { readRealSystemStats } = await import("./system.server");
    const s = await readRealSystemStats();

    if (!announced) {
      announced = true;
      // additive: never replaces what Node-RED announced
      announceEndpoints(
        SYS.map((e) => ({ ...e, kind: "read" as const })),
        { source: "pi-control", replace: false },
      );
    }

    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
    setEndpointValue("sys_cpu_pct", Math.round(n(s.cpu)));
    const total = n(s.ramTotalGb);
    if (total > 0) setEndpointValue("sys_mem_pct", Math.round((n(s.ramUsedGb) / total) * 100));
    setEndpointValue("sys_disk_pct", Math.round(n(s.diskUsedPct)));
    const temp = n(s.tempC);
    if (temp) setEndpointValue("sys_temp_c", Math.round(temp * 10) / 10);
    setEndpointValue("sys_uptime_h", Math.round((n(s.uptime) / 3600) * 10) / 10);
    debugLogVerbose("in", "Systemwerte gelesen", s, "local");
  } catch {
    /* best effort */
  }
}

/** Starts the 60s loop once per process. Safe to call from any handler. */
export function ensureSystemLoop(): void {
  if (timer) return;
  const everyMs = Math.max(30_000, Number(process.env.PI_CONTROL_SYS_INTERVAL_MS ?? 60_000));
  timer = setInterval(() => void reportSystemEndpoints(), everyMs);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }
  void reportSystemEndpoints();
}
