// PM2 ecosystem for pi-hub.
//
// We run the TanStack Start dev server under PM2 instead of a production
// build. Reason: the production build's server entry path moves between
// TanStack Start releases (dist/server/server.js vs .output/server/index.mjs),
// which caused restart loops on ARM. The dev server is fast, stable, and
// fits comfortably on a Pi 4 (~400 MB RSS).
//
// Usage on the Pi (after ./scripts/install.sh):
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # follow the printed sudo command for boot-on-restart

const path = require("path");

module.exports = {
  apps: [
    {
      name: "pi-hub",
      script: "npm",
      args: ["run", "dev", "--", "--host", "0.0.0.0", "--port", process.env.PORT || "3000"],
      interpreter: "none",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || "0.0.0.0",
      },
      restart_delay: 5000,
      max_memory_restart: "700M",
      autorestart: true,
      watch: false,
    },
  ],
};
