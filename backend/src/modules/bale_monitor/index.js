const { loadConfig } = require('./config');
const { BaleClient } = require('./baleClient');
const { MonitorStorage } = require('./storage');
const { parseCommand, validateUrl, parseInterval, parseDailyTime, parseId } = require('./parser');
const { checkUrl } = require('./checker');
const { MonitorScheduler } = require('./scheduler');

function formatTick(monitor, result) {
  const time = new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (result.ok) {
    return [
      '⏱ Monitor Tick',
      '',
      `URL: ${monitor.url}`,
      `Result: OK (${result.statusCode})`,
      `Latency: ${result.latencyMs}ms`,
      `Time: ${time}`
    ].join('\n');
  }

  return [
    '⏱ Monitor Tick',
    '',
    `URL: ${monitor.url}`,
    'Result: ERROR',
    `Error: ${result.error}`,
    `Latency: ${result.latencyMs}ms`,
    `Time: ${time}`
  ].join('\n');
}

function initBaleMonitor(app) {
  const cfg = loadConfig();
  if (!cfg.token) {
    console.warn('[BALE] BALE_BOT_TOKEN is missing. Bale monitor disabled.');
    return null;
  }

  const storage = new MonitorStorage(cfg.dbPath);
  const client = new BaleClient(cfg.token, 10000, 2);

  const scheduler = new MonitorScheduler({
    storage,
    timezone: cfg.timezone,
    onTick: async (monitorId) => {
      const monitor = storage.getById(monitorId);
      if (!monitor || Number(monitor.is_paused) === 1) return;
      const result = await checkUrl(monitor.url, cfg.monitorTimeoutMs);
      await client.sendMessage(monitor.chat_id, formatTick(monitor, result));
    }
  });

  scheduler.start();

  const parseChatId = (val) => {
    if (typeof val === 'number' && Number.isFinite(val)) return Math.trunc(val);
    if (typeof val === 'string' && /^-?\d+$/.test(val)) return Number(val);
    return null;
  };

  const normalizeWebhookUrl = (base, routePath) => {
    const b = String(base || '').replace(/\/+$/, '');
    const p = String(routePath || '').startsWith('/') ? routePath : `/${routePath}`;
    return `${b}${p}`;
  };

  if (cfg.webhookPublicUrl) {
    const targetWebhook = normalizeWebhookUrl(cfg.webhookPublicUrl, cfg.webhookPath);
    client
      .setWebhook(targetWebhook)
      .then(() => client.getWebhookInfo())
      .then((info) => {
        console.log('[BALE] webhook configured', {
          expected: targetWebhook,
          current: info?.result?.url || null
        });
      })
      .catch((err) => {
        console.error('[BALE] setWebhook failed', err?.message || err);
      });
  } else {
    console.warn('[BALE] BALE_WEBHOOK_PUBLIC_URL not set. Webhook registration skipped.');
  }

  app.post(cfg.webhookPath, async (req, res) => {
    try {
      const message = req.body?.message;
      if (!message || typeof message.text !== 'string') {
        return res.json({ ok: true, ignored: true });
      }

      const chatId = parseChatId(message.chat?.id);
      if (chatId === null) {
        return res.json({ ok: true, ignored: 'chat_id_missing' });
      }
      const parsed = parseCommand(message.text);
      if (!parsed) {
        await client.sendMessage(chatId, 'دستور نامعتبر است.');
        return res.json({ ok: true });
      }

      let reply = '';
      try {
        switch (parsed.name) {
          case '/add': {
            if (parsed.args.length !== 2) throw new Error('Usage: /add <url> <interval>');
            const url = validateUrl(parsed.args[0]);
            const seconds = parseInterval(parsed.args[1], cfg.minIntervalSeconds, cfg.maxIntervalSeconds);
            const m = storage.addInterval(chatId, url, seconds);
            scheduler.syncMonitor(m.id);
            reply = `Monitor added\nID: ${m.id}\nURL: ${m.url}\nEvery: ${m.interval_seconds}s`;
            break;
          }
          case '/addat': {
            if (parsed.args.length !== 2) throw new Error('Usage: /addat <url> <HH:MM>');
            const url = validateUrl(parsed.args[0]);
            const dailyTime = parseDailyTime(parsed.args[1]);
            const m = storage.addDaily(chatId, url, dailyTime);
            scheduler.syncMonitor(m.id);
            reply = `Daily monitor added\nID: ${m.id}\nURL: ${m.url}\nAt: ${m.daily_time}`;
            break;
          }
          case '/list': {
            const items = storage.listByChat(chatId);
            reply = items.length
              ? ['Monitors:', ...items.map((m) => `#${m.id} | ${m.url} | ${m.type === 'interval' ? `every ${m.interval_seconds}s` : `daily ${m.daily_time}`} | ${Number(m.is_paused) ? 'paused' : 'active'}`)].join('\n')
              : 'No monitors found.';
            break;
          }
          case '/remove': {
            if (parsed.args.length !== 1) throw new Error('Usage: /remove <id>');
            const id = parseId(parsed.args[0]);
            const ok = storage.remove(chatId, id);
            scheduler.removeJob(id);
            reply = ok ? `Monitor #${id} removed.` : 'Monitor not found.';
            break;
          }
          case '/pause': {
            if (parsed.args.length !== 1) throw new Error('Usage: /pause <id>');
            const id = parseId(parsed.args[0]);
            const ok = storage.setPaused(chatId, id, true);
            scheduler.syncMonitor(id);
            reply = ok ? `Monitor #${id} paused.` : 'Monitor not found.';
            break;
          }
          case '/resume': {
            if (parsed.args.length !== 1) throw new Error('Usage: /resume <id>');
            const id = parseId(parsed.args[0]);
            const ok = storage.setPaused(chatId, id, false);
            scheduler.syncMonitor(id);
            reply = ok ? `Monitor #${id} resumed.` : 'Monitor not found.';
            break;
          }
          default:
            reply = 'Commands: /add, /addat, /list, /remove, /pause, /resume';
        }
      } catch (cmdErr) {
        reply = cmdErr?.message || 'Invalid command';
      }

      await client.sendMessage(chatId, reply);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[BALE] webhook error', err);
      return res.status(500).json({ ok: false });
    }
  });

  console.log(`[BALE] webhook mounted at ${cfg.webhookPath}`);

  app.get('/api/bale/webhook-info', async (_req, res) => {
    try {
      const info = await client.getWebhookInfo();
      return res.json({ ok: true, info });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || 'getWebhookInfo failed' });
    }
  });

  app.post('/api/bale/set-webhook', async (req, res) => {
    try {
      const baseUrl = String(req.body?.baseUrl || cfg.webhookPublicUrl || '').trim();
      if (!baseUrl) {
        return res.status(400).json({ ok: false, error: 'baseUrl is required' });
      }
      const webhookUrl = normalizeWebhookUrl(baseUrl, cfg.webhookPath);
      const result = await client.setWebhook(webhookUrl);
      const info = await client.getWebhookInfo();
      return res.json({ ok: true, result, info });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || 'setWebhook failed' });
    }
  });

  if (cfg.usePolling) {
    let offset = 0;
    const poll = async () => {
      try {
        const data = await client.getUpdates(offset, 20);
        const updates = Array.isArray(data?.result) ? data.result : [];
        for (const upd of updates) {
          offset = Math.max(offset, Number(upd?.update_id || 0) + 1);
          const msg = upd?.message;
          if (!msg || typeof msg.text !== 'string') continue;
          const chatId = parseChatId(msg.chat?.id);
          if (chatId === null) continue;
          reqLikeHandle(chatId, msg.text);
        }
      } catch (err) {
        console.error('[BALE] polling error', err?.message || err);
      } finally {
        setTimeout(poll, 1200);
      }
    };

    const reqLikeHandle = async (chatId, text) => {
      const parsed = parseCommand(text);
      if (!parsed) {
        await client.sendMessage(chatId, 'دستور نامعتبر است.');
        return;
      }
      let reply = '';
      try {
        switch (parsed.name) {
          case '/add': {
            if (parsed.args.length !== 2) throw new Error('Usage: /add <url> <interval>');
            const url = validateUrl(parsed.args[0]);
            const seconds = parseInterval(parsed.args[1], cfg.minIntervalSeconds, cfg.maxIntervalSeconds);
            const m = storage.addInterval(chatId, url, seconds);
            scheduler.syncMonitor(m.id);
            reply = `Monitor added\nID: ${m.id}\nURL: ${m.url}\nEvery: ${m.interval_seconds}s`;
            break;
          }
          case '/addat': {
            if (parsed.args.length !== 2) throw new Error('Usage: /addat <url> <HH:MM>');
            const url = validateUrl(parsed.args[0]);
            const dailyTime = parseDailyTime(parsed.args[1]);
            const m = storage.addDaily(chatId, url, dailyTime);
            scheduler.syncMonitor(m.id);
            reply = `Daily monitor added\nID: ${m.id}\nURL: ${m.url}\nAt: ${m.daily_time}`;
            break;
          }
          case '/list': {
            const items = storage.listByChat(chatId);
            reply = items.length
              ? ['Monitors:', ...items.map((m) => `#${m.id} | ${m.url} | ${m.type === 'interval' ? `every ${m.interval_seconds}s` : `daily ${m.daily_time}`} | ${Number(m.is_paused) ? 'paused' : 'active'}`)].join('\n')
              : 'No monitors found.';
            break;
          }
          case '/remove': {
            if (parsed.args.length !== 1) throw new Error('Usage: /remove <id>');
            const id = parseId(parsed.args[0]);
            const ok = storage.remove(chatId, id);
            scheduler.removeJob(id);
            reply = ok ? `Monitor #${id} removed.` : 'Monitor not found.';
            break;
          }
          case '/pause': {
            if (parsed.args.length !== 1) throw new Error('Usage: /pause <id>');
            const id = parseId(parsed.args[0]);
            const ok = storage.setPaused(chatId, id, true);
            scheduler.syncMonitor(id);
            reply = ok ? `Monitor #${id} paused.` : 'Monitor not found.';
            break;
          }
          case '/resume': {
            if (parsed.args.length !== 1) throw new Error('Usage: /resume <id>');
            const id = parseId(parsed.args[0]);
            const ok = storage.setPaused(chatId, id, false);
            scheduler.syncMonitor(id);
            reply = ok ? `Monitor #${id} resumed.` : 'Monitor not found.';
            break;
          }
          default:
            reply = 'Commands: /add, /addat, /list, /remove, /pause, /resume';
        }
      } catch (cmdErr) {
        reply = cmdErr?.message || 'Invalid command';
      }
      await client.sendMessage(chatId, reply);
    };

    poll();
    console.log('[BALE] polling mode enabled');
  }

  return { storage, scheduler, client, config: cfg };
}

module.exports = { initBaleMonitor };
