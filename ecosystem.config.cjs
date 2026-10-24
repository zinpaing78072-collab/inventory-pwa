module.exports = {
  apps: [
    {
      name: "inventory-server",
      script: "apps/server/dist/server.js",
      cwd: __dirname,
      env: {
        PORT: 7300,
        NODE_ENV: "production",
      },
      // Android kills processes aggressively; pm2 + termux-wake-lock survive
      max_memory_restart: "300M",
      restart_delay: 3000,
    },
  ],
};
