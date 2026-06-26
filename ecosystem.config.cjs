// PM2 ecosystem for pi-hub.
const path = require("path");

module.exports = {
  apps: [
    {
      name: "pi-hub",
      script: ".output/server/index.mjs",
      interpreter: "node",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || "0.0.0.0",
      },
      restart_delay: 5000,
      max_memory_restart: "400M",
      autorestart: true,
      watch: false,
    },
  ],
};
