// Real Pi-side implementations: docker, /proc, vcgencmd. Loaded only when
// `isPiRuntime()` is true. Never import this from client code or from the
// top level of a `.functions.ts` file.

import { promises as fs } from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Docker from "dockerode";
import type { ContainerSummary, SystemStats } from "./mock-data";

const exec = promisify(execFile);

let _docker: Docker | null = null;
function docker() {
  if (!_docker) _docker = new Docker({ socketPath: "/var/run/docker.sock" });
  return _docker;
}

// ----- CPU% via two /proc/stat snapshots ---------------------------------
let lastCpu: { idle: number; total: number } | null = null;

async function readCpuPct(): Promise<number> {
  const text = await fs.readFile("/proc/stat", "utf8");
  const line = text.split("\n", 1)[0];
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((a, b) => a + b, 0);
  if (!lastCpu) {
    lastCpu = { idle, total };
    // first call has no baseline; fall back to a 1-core estimate
    const load = os.loadavg()[0] ?? 0;
    return Math.min(100, Math.round((load / os.cpus().length) * 100));
  }
  const dIdle = idle - lastCpu.idle;
  const dTotal = total - lastCpu.total;
  lastCpu = { idle, total };
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}

async function readMem(): Promise<{ usedGb: number; totalGb: number }> {
  const text = await fs.readFile("/proc/meminfo", "utf8");
  const totalKb = +(text.match(/MemTotal:\s+(\d+)/)?.[1] ?? 0);
  const availKb = +(text.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0);
  return {
    totalGb: +(totalKb / 1024 / 1024).toFixed(2),
    usedGb: +((totalKb - availKb) / 1024 / 1024).toFixed(2),
  };
}

async function readUptime(): Promise<string> {
  try {
    const text = await fs.readFile("/proc/uptime", "utf8");
    const secs = Math.floor(parseFloat(text.split(" ")[0] ?? "0"));
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  } catch {
    return "—";
  }
}

async function readTempC(): Promise<number> {
  try {
    const { stdout } = await exec("vcgencmd", ["measure_temp"], {
      timeout: 300,
    });
    const n = parseFloat(stdout.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) return n;
  } catch {
    /* fall through */
  }
  try {
    const text = await fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const milli = parseInt(text.trim(), 10);
    if (Number.isFinite(milli)) return +(milli / 1000).toFixed(1);
  } catch {
    /* ignore */
  }
  return 0;
}

async function readDiskPct(): Promise<number> {
  try {
    const { stdout } = await exec("df", ["-P", "/"], { timeout: 500 });
    const line = stdout.trim().split("\n").pop() ?? "";
    const cols = line.split(/\s+/);
    const pct = parseInt(cols[4]?.replace("%", "") ?? "0", 10);
    return Number.isFinite(pct) ? pct : 0;
  } catch {
    return 0;
  }
}

export async function readRealSystemStats(): Promise<SystemStats> {
  const [cpu, mem, uptime, tempC, diskUsedPct] = await Promise.all([
    readCpuPct(),
    readMem(),
    readUptime(),
    readTempC(),
    readDiskPct(),
  ]);
  return {
    hostname: os.hostname(),
    uptime,
    cpu,
    ramUsedGb: mem.usedGb,
    ramTotalGb: mem.totalGb,
    diskUsedPct,
    tempC,
    version: "pi-hub",
  };
}

// ----- Docker ------------------------------------------------------------

function mapStatus(state: string): ContainerSummary["status"] {
  switch (state) {
    case "running":
      return "running";
    case "restarting":
      return "restarting";
    case "paused":
    case "exited":
    case "dead":
    case "created":
      return "exited";
    default:
      return "warning";
  }
}

export async function listRealContainers(): Promise<ContainerSummary[]> {
  const cs = await docker().listContainers({ all: true });
  return cs.map((c) => {
    const ports = Array.from(
      new Set((c.Ports ?? []).map((p) => String(p.PublicPort ?? p.PrivatePort))),
    ).filter(Boolean);
    const looksMqtt =
      /mosquitto|emqx|hivemq|nanomq|vernemq/i.test(c.Image) ||
      ports.includes("1883") ||
      ports.includes("8883");
    return {
      id: c.Id.slice(0, 12),
      name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
      image: c.Image,
      status: mapStatus(c.State),
      uptime: c.Status,
      ports,
      network: Object.keys(c.NetworkSettings?.Networks ?? {})[0] ?? "bridge",
      cpu: 0,
      mem: 0,
      isMqtt: looksMqtt,
    };
  });
}

export async function getRealContainer(idPrefix: string) {
  const cs = await listRealContainers();
  const summary = cs.find((c) => c.id === idPrefix || c.id.startsWith(idPrefix));
  if (!summary) return null;
  let logs: string[] = [];
  try {
    const c = docker().getContainer(summary.id);
    const buf = (await c.logs({
      tail: 200,
      stdout: true,
      stderr: true,
      follow: false,
      timestamps: false,
    })) as unknown as Buffer;
    logs = buf
      .toString("utf8")
      // strip docker log multiplexing 8-byte headers (best-effort)
      .replace(/\x00\x00\x00\x00.{4}/g, "")
      .split("\n")
      .filter(Boolean)
      .slice(-200);
  } catch (e) {
    logs = [`[pi-hub] could not read logs: ${(e as Error).message}`];
  }
  return { ...summary, logs };
}

export async function runContainerAction(
  idPrefix: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  const cs = await docker().listContainers({ all: true });
  const match = cs.find((c) => c.Id.slice(0, 12) === idPrefix || c.Id.startsWith(idPrefix));
  if (!match) throw new Error(`container ${idPrefix} not found`);
  const c = docker().getContainer(match.Id);
  if (action === "start") await c.start();
  else if (action === "stop") await c.stop();
  else await c.restart();
}
