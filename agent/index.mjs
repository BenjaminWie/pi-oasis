#!/usr/bin/env node
// Pi Hub Agent — lightweight long-polling agent for the Lovable Cloud relay.
// Zero runtime deps. Uses node:http(s), node:fs, node:os, node:child_process.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { homedir, hostname, cpus, totalmem, freemem, uptime } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit, env } from "node:process";
import { execSync } from "node:child_process";

const CFG_DIR = join(env.PI_AGENT_HOME || homedir(), ".pi-agent");
const CFG_FILE = join(CFG_DIR, "config.json");

function loadConfig() {
  if (!existsSync(CFG_FILE)) return null;
  return JSON.parse(readFileSync(CFG_FILE, "utf8"));
}
function saveConfig(cfg) {
  if (!existsSync(CFG_DIR)) mkdirSync(CFG_DIR, { recursive: true });
  writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
}

// --- system snapshot --------------------------------------------------------

let lastCpu = null;
function readCpu() {
  // returns 0-100, sampled across calls
  const c = cpus();
  let idle = 0,
    total = 0;
  for (const x of c) {
    for (const k of Object.keys(x.times)) total += x.times[k];
    idle += x.times.idle;
  }
  if (!lastCpu) {
    lastCpu = { idle, total };
    return null;
  }
  const di = idle - lastCpu.idle;
  const dt = total - lastCpu.total;
  lastCpu = { idle, total };
  if (dt <= 0) return null;
  return Math.max(0, Math.min(100, 100 * (1 - di / dt)));
}

function readTemp() {
  try {
    const t = readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim();
    return Number(t) / 1000;
  } catch {
    try {
      const out = execSync("vcgencmd measure_temp", { timeout: 1000 }).toString();
      const m = out.match(/=([\d.]+)/);
      if (m) return Number(m[1]);
    } catch {}
    return null;
  }
}

function readDisk() {
  try {
    const out = execSync("df -P /", { timeout: 1500 }).toString();
    const line = out.split("\n")[1];
    const cols = line.split(/\s+/);
    return Number(cols[4].replace("%", ""));
  } catch {
    return null;
  }
}

function listContainers() {
  try {
    const out = execSync("docker ps -a --format '{{.Names}}|{{.State}}|{{.Image}}'", {
      timeout: 3000,
    }).toString();
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, status, image] = l.split("|");
        return { name, status, image };
      });
  } catch {
    return [];
  }
}

function detectMqttBrokers(containers) {
  return containers
    .filter((c) =>
      /mosquitto|emqx|hivemq|nanomq|vernemq|mqtt/i.test(c.name + " " + (c.image || "")),
    )
    .map((c) => c.name);
}

function snapshot() {
  const cpu = readCpu();
  const ram = (1 - freemem() / totalmem()) * 100;
  const containers = listContainers();
  return {
    cpu: cpu == null ? undefined : cpu,
    ram,
    temp: readTemp() ?? undefined,
    disk: readDisk() ?? undefined,
    uptime: uptime(),
    containers,
    mqtt_brokers: detectMqttBrokers(containers),
  };
}

// --- command handlers -------------------------------------------------------

async function handleCommand(cmd) {
  try {
    if (cmd.kind === "status") {
      return { ok: true, result: snapshot() };
    }
    if (cmd.kind === "container_action") {
      const { name, action } = cmd.payload || {};
      if (!["start", "stop", "restart"].includes(action)) {
        return { ok: false, result: { error: "invalid action" } };
      }
      execSync(`docker ${action} ${shellEscape(name)}`, { timeout: 10000 });
      return { ok: true, result: { name, action } };
    }
    if (cmd.kind === "mqtt_publish") {
      const { topic, payload, broker, port } = cmd.payload || {};
      const hostStr = String(broker || "127.0.0.1");
      // Allow only hostnames/IPv4/IPv6 chars — no shell metachars.
      if (!/^[a-zA-Z0-9_.\-:]{1,253}$/.test(hostStr)) {
        return { ok: false, result: { error: "invalid broker host" } };
      }
      const portNum = Number(port ?? 1883);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return { ok: false, result: { error: "invalid port" } };
      }
      if (typeof topic !== "string" || !topic.length) {
        return { ok: false, result: { error: "invalid topic" } };
      }
      try {
        execSync(
          `mosquitto_pub -h ${shellEscape(hostStr)} -p ${portNum} -t ${shellEscape(topic)} -m ${shellEscape(payload || "")}`,
          { timeout: 5000 },
        );
        return { ok: true, result: { topic } };
      } catch (e) {
        return { ok: false, result: { error: "mosquitto_pub failed: " + String(e.message || e) } };
      }
    }
    return { ok: false, result: { error: "unknown kind " + cmd.kind } };
  } catch (e) {
    return { ok: false, result: { error: String(e.message || e) } };
  }
}

function shellEscape(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// --- HTTP helpers -----------------------------------------------------------

async function http(method, url, opts = {}) {
  const u = new URL(url);
  const lib = u.protocol === "http:" ? await import("node:http") : await import("node:https");
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search,
        headers: opts.headers || {},
        timeout: opts.timeout || 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function post(cfg, path, payload) {
  const r = await http("POST", cfg.cloudUrl + path, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.deviceToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (r.status >= 400) throw new Error(`POST ${path} -> ${r.status}: ${r.body}`);
  return r.body ? JSON.parse(r.body) : null;
}

// --- commands ---------------------------------------------------------------

async function cmdRegister(args) {
  const flags = parseFlags(args);
  const rl = createInterface({ input: stdin, output: stdout });
  const cloudUrl = (flags.url || (await rl.question("Cloud-URL: "))).replace(/\/+$/, "");
  const code = (flags.code || (await rl.question("Pairing-Code: "))).trim().toUpperCase();
  rl.close();

  const r = await http("POST", cloudUrl + "/api/public/agent/register", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, hostname: hostname() }),
  });
  if (r.status >= 400) {
    console.error("Registrierung fehlgeschlagen:", r.status, r.body);
    exit(1);
  }
  const data = JSON.parse(r.body);
  saveConfig({
    cloudUrl,
    deviceId: data.deviceId,
    deviceToken: data.deviceToken,
    heartbeatSec: 30,
  });
  console.log("✅ Gerät registriert als:", data.name);
  console.log("   Config:", CFG_FILE);
  console.log("   Starte Daemon mit: pi-agent run");
}

async function cmdStatus() {
  const s = snapshot();
  // give CPU sample a moment
  if (s.cpu == null) {
    await new Promise((r) => setTimeout(r, 500));
    Object.assign(s, snapshot());
  }
  console.log(JSON.stringify(s, null, 2));
}

async function cmdRun() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("Nicht registriert. Erst: pi-agent register");
    exit(1);
  }
  console.log(`[pi-agent] connected to ${cfg.cloudUrl} as device ${cfg.deviceId}`);

  // heartbeat loop
  let lastHeartbeat = 0;
  async function maybeHeartbeat() {
    const now = Date.now();
    if (now - lastHeartbeat < (cfg.heartbeatSec || 30) * 1000) return;
    lastHeartbeat = now;
    try {
      await post(cfg, "/api/public/agent/heartbeat", snapshot());
    } catch (e) {
      console.error("[heartbeat]", e.message);
    }
  }
  // poll loop
  while (true) {
    await maybeHeartbeat();
    try {
      const r = await http("GET", cfg.cloudUrl + "/api/public/agent/poll", {
        headers: { Authorization: `Bearer ${cfg.deviceToken}` },
        timeout: 35000,
      });
      if (r.status === 204) continue;
      if (r.status >= 400) {
        console.error("[poll]", r.status, r.body);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const { command } = JSON.parse(r.body);
      if (!command) continue;
      console.log("[cmd]", command.kind, command.id);
      const result = await handleCommand(command);
      await post(cfg, "/api/public/agent/result", { id: command.id, ...result });
    } catch (e) {
      console.error("[poll-error]", e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function cmdUnlink() {
  if (existsSync(CFG_FILE)) {
    execSync(`rm ${CFG_FILE}`);
    console.log("Config gelöscht.");
  } else console.log("Keine Config vorhanden.");
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

const [, , sub, ...rest] = argv;
switch (sub) {
  case "register":
    await cmdRegister(rest);
    break;
  case "run":
    await cmdRun();
    break;
  case "status":
    await cmdStatus();
    break;
  case "unlink":
    cmdUnlink();
    break;
  default:
    console.log(`Pi Hub Agent

Usage:
  pi-agent register --url <cloud-url> --code <pairing-code>
  pi-agent run                    # daemon: long-polls cloud
  pi-agent status                 # one-shot snapshot (JSON)
  pi-agent unlink                 # remove config

Config: ${CFG_FILE}`);
}
