// PM2 ecosystem for pi-hub on Raspberry Pi.
// Tight memory budget so a Pi 3 (1 GB RAM, no swap) stays responsive.
const path = require("path");

module.exports = {
  apps: [
    {
      name: "pi-hub",
      script: ".output/server/index.mjs",
      interpreter: "node",
      // Cap V8 heap so we never balloon past PM2's restart threshold.
      node_args: ["--max-old-space-size=192"],
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || "0.0.0.0",
      },
      restart_delay: 5000,
      max_memory_restart: "220M",
      autorestart: true,
      watch: false,
    },
  ],
};
