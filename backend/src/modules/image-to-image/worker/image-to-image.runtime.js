'use strict';

const { createImageToImageWorker } = require('./image-to-image.worker');

const ACTIVE_WORKER_MODES = new Set(['embedded', 'dedicated']);

function createImageToImageRuntime({ config, dependencies, timers = globalThis, logger = console }) {
  let timer = null;
  let started = false;
  let worker = null;

  const tick = async () => {
    if (!worker) return { action: 'not-started', processed: 0 };
    try {
      return await worker.tick();
    } catch (error) {
      logger?.error?.('[IMAGE_TO_IMAGE] worker tick failed', {
        errorCode: error?.code || 'IMAGE_TO_IMAGE_WORKER_FAILED'
      });
      return { action: 'failed', processed: 0 };
    }
  };

  return {
    async start() {
      const mode = String(config?.workerMode || '').trim().toLowerCase();
      if (started) return { started: true, enabled: Boolean(config?.enabled), mode };
      if (!config?.enabled || !ACTIVE_WORKER_MODES.has(mode)) {
        return { started: false, enabled: Boolean(config?.enabled), mode };
      }

      worker = createImageToImageWorker({ ...dependencies, config, logger });
      started = true;
      if (config.runImmediately) void tick();
      timer = timers.setInterval(tick, config.workerIntervalMs);
      timer?.unref?.();
      return { started: true, enabled: true, mode };
    },
    async stop() {
      if (timer) timers.clearInterval(timer);
      timer = null;
      worker = null;
      started = false;
    },
    tick,
    isStarted: () => started
  };
}

module.exports = { ACTIVE_WORKER_MODES, createImageToImageRuntime };
