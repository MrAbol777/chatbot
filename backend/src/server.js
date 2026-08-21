const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config({
  path: path.join(__dirname, '../.env')
});

const { loadRuntimeConfig } = require('./bootstrap/config');
const { log } = require('./bootstrap/logging');
const { createRepositories } = require('./repositories');
const { createApp } = require('./app');
const { initBaleMonitor } = require('./modules/bale_monitor');
const { createConfiguredVideoWorkerRuntime } = require('./modules/video-generation/worker/video-worker.bootstrap');
const { reconcileExpiredNoaOperations } = require('./modules/noa');

const runtimeConfig = loadRuntimeConfig(process.env);
const repositories = createRepositories();
const { app, noaBillingService, conversationMemoryService, setVideoWorkerRuntimeGetter } = createApp({
  repositories,
  runtimeConfig
});

let videoWorkerRuntime = null;
let serverSignalHandlersInstalled = false;
setVideoWorkerRuntimeGetter(() => videoWorkerRuntime);

async function startServer({ installSignalHandlers = true } = {}) {
  let server;
  let noaExpiryTimer = null;
  let shutdownPromise = null;

  const shutdown = async () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log('[BOOT] Starting graceful shutdown...');
      await videoWorkerRuntime?.stop?.();
      if (noaExpiryTimer) clearInterval(noaExpiryTimer);
      if (server) await new Promise((resolve) => server.close(resolve));
      await repositories.db.close();
      console.log('[BOOT] Graceful shutdown completed.');
    })();
    return shutdownPromise;
  };

  try {
    await repositories.db.init();
    await conversationMemoryService.ensureMetadataTables();
    await conversationMemoryService.ensureStorageRoot();
    console.log('[BOOT] Database initialized');

    if (String(process.env.BALE_MONITOR_ENABLED || '0') === '1') {
      initBaleMonitor(app);
    } else {
      console.log('[BALE] monitor disabled');
    }

    videoWorkerRuntime = createConfiguredVideoWorkerRuntime({
      db: repositories.db,
      httpClient: axios,
      noaBillingService,
      env: process.env,
      role: 'embedded',
      logger: console
    });
    await videoWorkerRuntime.start();

    const sweepExpiredNoaReservations = async () => {
      const released = await noaBillingService.releaseExpiredReservations({ limit: 250 });
      const reconciled = await reconcileExpiredNoaOperations(repositories.db);
      return { released, reconciled };
    };

    await sweepExpiredNoaReservations().catch((error) => {
      console.error('[NOA] Initial reservation cleanup failed:', error.message);
    });

    noaExpiryTimer = setInterval(() => {
      sweepExpiredNoaReservations().catch((error) => {
        console.error('[NOA] Reservation cleanup failed:', error.message);
      });
    }, 60_000);
    noaExpiryTimer.unref?.();
  } catch (err) {
    console.error('[BOOT] Database initialization failed:', err.message);
    throw err;
  }

  const { port, host, defaultModel, metisBaseUrl, defaultTimeoutMs, ai } = runtimeConfig;

  server = app.listen(port, host, () => {
    log('BOOT', 'backend_started', {
      host,
      port,
      model: defaultModel,
      baseUrl: metisBaseUrl,
      timeoutMs: defaultTimeoutMs
    });
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = Math.max(190000, Number(ai?.vision?.timeoutMs || 45000) + 15000);

  if (installSignalHandlers && !serverSignalHandlersInstalled) {
    serverSignalHandlersInstalled = true;
    const handler = async () => {
      await shutdown();
      process.exit(0);
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }

  return { app, server, videoWorkerRuntime, shutdown };
}

if (require.main === module) {
  startServer().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
