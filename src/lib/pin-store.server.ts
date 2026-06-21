// Pi-local state store: hashed PIN, factory reset token, trusted devices,
// cloud bridge config. Lives at ~/.pi-hub/state.json. Server-only.
import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const DIR = process.env.PI_HUB_HOME || join(homedir(), ".pi-hub");
const FILE = join(DIR, "state.json");

export interface TrustedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface CloudBridgeConfig {
  cloudUrl: string;
  deviceId: string;
  deviceToken: string;
  name: string;
  installedAt: string;
}

export interface PiState {
  pinHash: string;
  pinSalt: string;
  factoryToken: string;
  trustedDevices: TrustedDevice[];
  cloud?: CloudBridgeConfig;
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString("hex");
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

export async function loadState(): Promise<PiState> {
  ensureDir();
  if (!existsSync(FILE)) {
    const initialPin = process.env.PI_DASHBOARD_PIN || "1234";
    const salt = randomBytes(16).toString("hex");
    const state: PiState = {
      pinHash: hashPin(initialPin, salt),
      pinSalt: salt,
      factoryToken: randomBytes(16).toString("hex"),
      trustedDevices: [],
    };
    await fs.writeFile(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    return state;
  }
  const raw = await fs.readFile(FILE, "utf8");
  return JSON.parse(raw) as PiState;
}

export async function saveState(state: PiState): Promise<void> {
  ensureDir();
  await fs.writeFile(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export async function verifyPinValue(pin: string): Promise<boolean> {
  const s = await loadState();
  const got = Buffer.from(hashPin(pin, s.pinSalt), "hex");
  const want = Buffer.from(s.pinHash, "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export async function setPinValue(newPin: string): Promise<void> {
  const s = await loadState();
  const salt = randomBytes(16).toString("hex");
  s.pinSalt = salt;
  s.pinHash = hashPin(newPin, salt);
  await saveState(s);
}

export async function getFactoryToken(): Promise<string> {
  const s = await loadState();
  return s.factoryToken;
}

export async function verifyFactoryToken(token: string): Promise<boolean> {
  const s = await loadState();
  const a = Buffer.from(token);
  const b = Buffer.from(s.factoryToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function recordTrustedDevice(label: string): Promise<string> {
  const s = await loadState();
  const id = randomBytes(8).toString("hex");
  s.trustedDevices = s.trustedDevices || [];
  const now = new Date().toISOString();
  s.trustedDevices.unshift({ id, label, createdAt: now, lastSeenAt: now });
  // keep last 16
  s.trustedDevices = s.trustedDevices.slice(0, 16);
  await saveState(s);
  return id;
}

export async function revokeAllTrustedDevices(): Promise<void> {
  const s = await loadState();
  s.trustedDevices = [];
  await saveState(s);
}

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const s = await loadState();
  return s.trustedDevices || [];
}

export async function setCloudConfig(cfg: CloudBridgeConfig | null): Promise<void> {
  const s = await loadState();
  if (cfg) s.cloud = cfg;
  else delete s.cloud;
  await saveState(s);
}

export async function getCloudConfig(): Promise<CloudBridgeConfig | null> {
  const s = await loadState();
  return s.cloud ?? null;
}
