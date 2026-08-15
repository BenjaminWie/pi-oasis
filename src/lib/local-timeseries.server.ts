// Pi-local 48h time series store. Server-only.
//
// Everything Node-RED pushes to the local app (events, live ticks, decisions,
// trace lines) is appended to daily JSONL files so statistics stay verifiable
// locally even when the cloud is unreachable.
//
// SD-CARD PROTECTION (Phase 4):
//   * everything is buffered in RAM and flushed at most every 15 minutes
//     (PI_HUB_FLUSH_MS) or when the buffer grows past PI_HUB_FLUSH_LINES
//   * live ticks are down-sampled to one persisted row per 15s
//   * PI_HUB_TS_RAM=1 keeps the whole store in /dev/shm → zero card writes
//   * PI_HUB_TELEMETRY_DIR=/mnt/usb/... moves the store to USB/SSD
//   * a flush runs on SIGINT/SIGTERM/beforeExit so nothing is lost on reboot

import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolveDir(): string {
  const explicit = process.env.PI_HUB_TELEMETRY_DIR;
  if (explicit) return explicit;
  const ram = process.env.PI_HUB_TS_RAM;
  if (ram === "1" || ram === "true") return "/dev/shm/pi-hub/telemetry";
  return join(process.env.PI_HUB_HOME || join(homedir(), ".pi-hub"), "telemetry");
}

const DIR = resolveDir();
const RETENTION_HOURS = Math.max(1, Number(process.env.PI_HUB_RETENTION_HOURS ?? 48));
// 15 min instead of 5 s: ~96 card writes/day instead of ~17k.
const FLUSH_MS = Math.max(1_000, Number(process.env.PI_HUB_FLUSH_MS ?? 15 * 60_000));
const FLUSH_LINES = Math.max(10, Number(process.env.PI_HUB_FLUSH_LINES ?? 2_000));
const TICK_PERSIST_MS = Math.max(1_000, Number(process.env.PI_HUB_TICK_PERSIST_MS ?? 15_000));


export type TsKind = "event" | "tick" | "decision" | "trace";

export interface TsRow {
  kind: TsKind;
  ts: string;
  [k: string]: unknown;
}

export interface TraceRow extends TsRow {
  kind: "trace";
  rid?: string;
  route?: string;
  status?: number | null;
  ms?: number | null;
  ok?: boolean;
  reason?: string | null;
  body?: unknown;
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function fileFor(kind: TsKind, day: string) {
  return join(DIR, `${kind}-${day}.jsonl`);
}

// ---------------------------------------------------------------- write side

const pending: TsRow[] = [];
// In-memory mirror so reads are instant and cover everything that has not been
// flushed to the card yet (with a 15 min flush window this is the primary read
// path — the JSONL files only matter after a restart).
const recent: Record<TsKind, TsRow[]> = { event: [], tick: [], decision: [], trace: [] };
const RECENT_MAX = Math.max(500, Number(process.env.PI_HUB_RECENT_MAX ?? 3_000));

let timer: ReturnType<typeof setTimeout> | null = null;
let lastTickPersist = 0;

function remember(row: TsRow) {
  const arr = recent[row.kind];
  arr.push(row);
  if (arr.length > RECENT_MAX) arr.splice(0, arr.length - RECENT_MAX);
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushLocalTimeseries();
  }, FLUSH_MS);
  // don't keep the process alive just for a flush
  (timer as any)?.unref?.();
}

export function appendLocalRows(kind: TsKind, rows: Array<Record<string, unknown>>): number {
  const now = new Date().toISOString();
  let stored = 0;
  for (const r of rows) {
    const row: TsRow = { ...r, kind, ts: typeof r.ts === "string" ? (r.ts as string) : now };
    remember(row);
    if (kind === "tick") {
      const t = Date.now();
      if (t - lastTickPersist < TICK_PERSIST_MS) continue;
      lastTickPersist = t;
    }
    pending.push(row);
    stored++;
  }
  if (pending.length >= FLUSH_LINES) void flushLocalTimeseries();
  else if (pending.length) schedule();
  return stored;
}

export async function flushLocalTimeseries(): Promise<void> {
  if (!pending.length) {
    await pruneOld();
    return;
  }
  const batch = pending.splice(0, pending.length);
  ensureDir();
  const byFile = new Map<string, string[]>();
  for (const row of batch) {
    const f = fileFor(row.kind, dayKey(row.ts));
    const list = byFile.get(f) ?? [];
    list.push(JSON.stringify(row));
    byFile.set(f, list);
  }
  for (const [f, lines] of byFile) {
    try {
      await fs.appendFile(f, lines.join("\n") + "\n", { mode: 0o600 });
    } catch (e) {
      console.warn("[local-ts] append failed", f, e);
    }
  }
  await pruneOld();
}

// Flush before the process goes away so a reboot does not lose up to 15 min.
let exitHooked = false;
function hookExitFlush() {
  if (exitHooked || typeof process?.on !== "function") return;
  exitHooked = true;
  const bye = () => {
    void flushLocalTimeseries();
  };
  process.on("beforeExit", bye);
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
hookExitFlush();

/** Where telemetry is stored and how card-friendly the current config is. */
export function localStorageInfo() {
  return {
    dir: DIR,
    ram_only: DIR.startsWith("/dev/shm"),
    retention_hours: RETENTION_HOURS,
    flush_ms: FLUSH_MS,
    flush_lines: FLUSH_LINES,
    tick_persist_ms: TICK_PERSIST_MS,
    pending: pending.length,
    approx_writes_per_day: Math.round(86_400_000 / FLUSH_MS),
  };
}


let lastPrune = 0;
async function pruneOld() {
  if (Date.now() - lastPrune < 60 * 60_000) return;
  lastPrune = Date.now();
  try {
    ensureDir();
    const cutoff = Date.now() - RETENTION_HOURS * 3600_000;
    const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
    for (const name of await fs.readdir(DIR)) {
      const m = /^(event|tick|decision|trace)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (!m) continue;
      if (m[2] < cutoffDay) await fs.unlink(join(DIR, name)).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------- read side

export async function readRange(kind: TsKind, sinceIso: string, limit = 5000): Promise<TsRow[]> {
  const out: TsRow[] = [];
  try {
    ensureDir();
    const names = (await fs.readdir(DIR))
      .filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".jsonl"))
      .sort();
    for (const name of names) {
      const day = name.slice(kind.length + 1, kind.length + 11);
      if (day < sinceIso.slice(0, 10)) continue;
      const raw = await fs.readFile(join(DIR, name), "utf8").catch(() => "");
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const row = JSON.parse(line) as TsRow;
          if (row.ts >= sinceIso) out.push(row);
        } catch {
          /* skip broken line */
        }
      }
    }
  } catch {
    /* ignore */
  }
  // merge the not-yet-flushed in-memory rows
  for (const row of recent[kind]) {
    if (row.ts >= sinceIso && !out.some((o) => o === row)) out.push(row);
  }
  out.sort((a, b) => a.ts.localeCompare(b.ts));
  const dedup = out.filter(
    (r, i, arr) => i === 0 || JSON.stringify(r) !== JSON.stringify(arr[i - 1]),
  );
  return dedup.slice(-limit);
}

export function recentRows(kind: TsKind, limit = 100): TsRow[] {
  return recent[kind].slice(-limit).reverse();
}

export interface HourBucket {
  bucket: string;
  watts?: number;
  temp?: number;
  pv?: number;
  rain?: number;
  pump_on_ratio?: number;
  samples: number;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function hourlyBuckets(sinceIso: string): Promise<HourBucket[]> {
  const [ticks, events] = await Promise.all([
    readRange("tick", sinceIso),
    readRange("event", sinceIso),
  ]);
  const acc = new Map<
    string,
    { w: number[]; t: number[]; pv: number[]; rain: number[]; on: number[] }
  >();
  const add = (iso: string, m: Record<string, unknown>) => {
    const bucket = iso.slice(0, 13) + ":00:00.000Z";
    const e = acc.get(bucket) ?? { w: [], t: [], pv: [], rain: [], on: [] };
    const w = num(m.watts ?? m.watt ?? m.house_power);
    const t = num(m.outside_temp_c ?? m.temp_c ?? m.temperature);
    const pv = num(m.pv_surplus_w ?? m.pv_surplus);
    const rain = num(m.rain_next_24h_mm ?? m.rain_mm);
    if (w != null) e.w.push(w);
    if (t != null) e.t.push(t);
    if (pv != null) e.pv.push(pv);
    if (rain != null) e.rain.push(rain);
    if (typeof m.pump_on === "boolean") e.on.push(m.pump_on ? 1 : 0);
    acc.set(bucket, e);
  };
  for (const r of ticks) add(r.ts, r as Record<string, unknown>);
  for (const r of events)
    add(r.ts, { ...((r as any).metrics ?? {}), pump_on: (r as any).metrics?.pump_on });

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, e]) => ({
      bucket,
      watts: avg(e.w),
      temp: avg(e.t),
      pv: avg(e.pv),
      rain: e.rain.length ? Math.max(...e.rain) : undefined,
      pump_on_ratio: e.on.length ? (avg(e.on) as number) * 100 : undefined,
      samples: e.w.length + e.t.length + e.pv.length,
    }));
}

export async function lastSeenByComponent(
  sinceIso: string,
): Promise<Array<{ component: string; ts: string; count: number; lastStatus?: string }>> {
  const events = await readRange("event", sinceIso);
  const map = new Map<string, { ts: string; count: number; lastStatus?: string }>();
  for (const e of events) {
    const c = String((e as any).component ?? "unknown");
    const cur = map.get(c) ?? { ts: e.ts, count: 0 };
    cur.count++;
    if (e.ts >= cur.ts) {
      cur.ts = e.ts;
      cur.lastStatus = (e as any).status;
    }
    map.set(c, cur);
  }
  return [...map.entries()]
    .map(([component, v]) => ({ component, ...v }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
}
