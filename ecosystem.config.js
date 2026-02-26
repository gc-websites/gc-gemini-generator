module.exports = {
  apps: [
    {
      name: "gc-gemini-generator",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false, // PM2 will not auto-restart upon file changes
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4000
      },
      // Since it's using Playwright, you may want to set certain environment variables
      // to ensure Playwright browsers can run smoothly. Usually non-headless requires a display server,
      // but if you run headless=false, you MUST have XVFB or a Windows desktop running on EC2.
      // E.g., if on Linux EC2, you'd likely use xvfb-run or switch to headless: true for production.
    }
  ]
};
