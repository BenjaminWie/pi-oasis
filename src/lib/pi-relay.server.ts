// Cloud → Pi relay. Server-only, DATABASE-FREE.
//
// The cloud app (pi-hub.benniwie.com) keeps no state of its own any more: it
// forwards reads and commands to the Pi over its Cloudflare-Tunnel URL and
// caches the last successful answer in worker memory (volatile, free).
//
// Config (secrets on the cloud side):
//   PIHUB_PI_URL       https://pi.example.com   — tunnel URL of the Pi
//   PIHUB_DEVICE_TOKEN <token>                  — same value as PI_INGEST_TOKEN on the Pi

const TIMEOUT_MS = Number(process.env.PIHUB_RELAY_TIMEOUT_MS ?? 6_000);

export interface PiState {
  ts: string;
  pump_on?: boolean;
  watts?: number;
  pv_surplus_w?: number;
  outside_temp_c?: number;
  rain_next_24h_mm?: number;
  strategy_applied?: string;
  reason?: string;
  cpu_pct?: number;
  mem_pct?: number;
  disk_pct?: number;
  temp_c?: number;
  uptime_s?: number;
  mqtt_broker_up?: boolean;
  [k: string]: unknown;
}

export interface RelayRead<T> {
  ok: boolean;
  data: T | null;
  /** true when the Pi did not answer and we served the volatile cache */
  stale: boolean;
  /** age of the cached answer in seconds (only when stale) */
  ageSec: number | null;
  error?: string;
}

export function piConfig() {
  const url = (process.env.PIHUB_PI_URL || "").replace(/\/+$/, "");
  const token = process.env.PIHUB_DEVICE_TOKEN || "";
  return { url, token, configured: Boolean(url && token) };
}

// ------------------------------------------------------- volatile RAM cache
const cache = new Map<string, { at: number; value: unknown }>();

export function cacheGet<T>(key: string): { value: T; ageSec: number } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  return { value: hit.value as T, ageSec: Math.round((Date.now() - hit.at) / 1000) };
}

export function cachePut(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
}

export function describeAge(ageSec: number | null): string {
  if (ageSec == null) return "";
  if (ageSec < 90) return "gerade eben";
  const min = Math.round(ageSec / 60);
  if (min < 60) return `vor ${min} Minuten`;
  const h = Math.round(min / 60);
  return `vor ${h} Stunden`;
}

// ------------------------------------------------------------------ fetching
async function piFetch(path: string, init?: RequestInit): Promise<Response> {
  const { url, token, configured } = piConfig();
  if (!configured) throw new Error("pi_not_configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/** GET a JSON document from the Pi, falling back to the volatile cache. */
export async function relayGet<T>(path: string, cacheKey = path): Promise<RelayRead<T>> {
  try {
    const res = await piFetch(path);
    if (!res.ok) throw new Error(`pi_http_${res.status}`);
    const data = (await res.json()) as T;
    cachePut(cacheKey, data);
    return { ok: true, data, stale: false, ageSec: 0 };
  } catch (e: any) {
    const hit = cacheGet<T>(cacheKey);
    if (hit) return { ok: true, data: hit.value, stale: true, ageSec: hit.ageSec };
    return { ok: false, data: null, stale: false, ageSec: null, error: String(e?.message ?? e) };
  }
}

/** Latest live state of the Pi (pump, energy, system). */
export async function getPiState(): Promise<RelayRead<PiState>> {
  return relayGet<PiState>("/api/public/pi/state", "state");
}

/** Send a command to the Pi. Never cached — a failure must be reported. */
export async function relayCommand(
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const res = await piFetch("/api/public/pi/command", {
      method: "POST",
      body: JSON.stringify({ kind, payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (body as any)?.error ?? `pi_http_${res.status}` };
    return { ok: true, result: body };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { ok: false, error: msg === "pi_not_configured" ? "pi_not_configured" : "pi_offline" };
  }
}
