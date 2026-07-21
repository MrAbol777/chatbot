const path = require('path');

const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;

function loadConfig() {
  const token = (process.env.BALE_BOT_TOKEN || '').trim();
  const webhookPath = (process.env.BALE_WEBHOOK_PATH || '/bale/webhook').trim();
  const webhookPublicUrl = (process.env.BALE_WEBHOOK_PUBLIC_URL || '').trim();
  const timezone = (process.env.BALE_TIMEZONE || process.env.TZ || 'Asia/Tehran').trim();
  const dbPath = (process.env.BALE_MONITOR_DB_PATH || path.join(__dirname, '../../../data/bale-monitor.json')).trim();
  const monitorTimeoutMs = Number(process.env.BALE_MONITOR_REQUEST_TIMEOUT_MS || 15000);
  const usePolling = ['1', 'true', 'yes'].includes(String(process.env.BALE_USE_POLLING || '').toLowerCase());

  return {
    token,
    webhookPath,
    webhookPublicUrl,
    timezone,
    dbPath,
    monitorTimeoutMs,
    usePolling,
    minIntervalSeconds: MIN_INTERVAL_SECONDS,
    maxIntervalSeconds: MAX_INTERVAL_SECONDS
  };
}

module.exports = { loadConfig, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS };
