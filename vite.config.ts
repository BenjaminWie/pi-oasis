import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    preset: "node-server",
  },
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: {
      rollupOptions: {
        external: ["dockerode", "node-pty", "ssh2", "mqtt"],
      },
    },
    define: {
      "process.env.VITE_PI_SLIM_MODE": JSON.stringify(process.env.VITE_PI_SLIM_MODE),
    },
  },
});
