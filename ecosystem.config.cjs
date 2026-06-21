// PM2 ecosystem for pi-hub.
// Usage on the Pi (after ./scripts/install.sh):
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # follow the printed sudo command for boot-on-restart
//
// PM2 handles restarts, log rotation, and PATH issues that systemd + NVM hit.
const fs = require("fs");
const path = require("path");

const candidates = [
  "dist/server/server.js",
  "dist/server/index.mjs",
  ".output/server/index.mjs",
];
const script =
  candidates.find((p) => fs.existsSync(path.join(__dirname, p))) ||
  "dist/server/server.js";

module.exports = {
  apps: [
    {
      name: "pi-hub",
      script,
      cwd: __dirname,
      node_args: "--max-old-space-size=192",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || "0.0.0.0",
      },
      restart_delay: 5000,
      max_memory_restart: "250M",
      autorestart: true,
      watch: false,
    },
  ],
};
