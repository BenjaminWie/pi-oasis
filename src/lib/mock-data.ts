// Mock data layer. Replace with real Docker / /proc reads when running on the Pi.
// Server functions consume these so the swap later is one file.

export type ContainerStatus = "running" | "exited" | "restarting" | "warning";

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  uptime: string;
  ports: string[];
  network: string;
  cpu: number;
  mem: number;
}

export interface SystemStats {
  hostname: string;
  uptime: string;
  cpu: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedPct: number;
  tempC: number;
  version: string;
}

export const mockStats: SystemStats = {
  hostname: "pi-cluster-01",
  uptime: "14d 02h 12m",
  cpu: 42,
  ramUsedGb: 1.2,
  ramTotalGb: 4,
  diskUsedPct: 64,
  tempC: 48,
  version: "v2.0.4-β",
};

export const mockContainers: ContainerSummary[] = [
  {
    id: "80a91",
    name: "home-assistant",
    image: "ghcr.io/home-assistant:stable",
    status: "running",
    uptime: "12d 4h",
    ports: ["8123"],
    network: "bridge",
    cpu: 8,
    mem: 412,
  },
  {
    id: "b3f12",
    name: "pi-hole",
    image: "pihole/pihole:latest",
    status: "exited",
    uptime: "—",
    ports: ["53", "80"],
    network: "host",
    cpu: 0,
    mem: 0,
  },
  {
    id: "c0092",
    name: "nginx-proxy-manager",
    image: "jc21/nginx-proxy-manager:latest",
    status: "running",
    uptime: "30d 1h",
    ports: ["80", "443", "81"],
    network: "bridge",
    cpu: 2,
    mem: 88,
  },
  {
    id: "d7a44",
    name: "plex",
    image: "linuxserver/plex:latest",
    status: "warning",
    uptime: "2h 14m",
    ports: ["32400"],
    network: "host",
    cpu: 21,
    mem: 612,
  },
];

export function mockLogs(name: string): string[] {
  return [
    `[04:02:11] INFO: ${name} initializing subsystem...`,
    `[04:02:12] SUCCESS: node protocol active`,
    `[04:05:44] GET /api/v1/telemetry 200`,
    `[04:06:01] AUTH: request granted for admin`,
    `[04:06:15] INFO: heartbeat ok`,
    `[04:06:42] DEBUG: cache flush (12 entries)`,
  ];
}
