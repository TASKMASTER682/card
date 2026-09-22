const fetch = require("node-fetch");

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

function startKeepAlive() {
  const target = process.env.KEEPALIVE_URL;
  const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  if (!target) {
    console.warn("[keepalive] KEEPALIVE_URL is not set — keep-alive cron disabled.");
    return;
  }

  const ping = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch(target, { signal: controller.signal }).catch(() => {});
  };

  ping();
  const interval = setInterval(ping, intervalMs);
  interval.unref();
  console.log(`[keepalive] Pinging ${target} every ${intervalMs / 60000} minutes`);
}

module.exports = { startKeepAlive };