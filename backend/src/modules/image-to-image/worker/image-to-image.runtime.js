'use strict';

const { createImageToImageWorker } = require('./image-to-image.worker');

function createImageToImageRuntime({ config, dependencies, timers = globalThis, logger = console }) {
  let timer = null; let started = false; let worker = null;
  const tick = async () => worker?.tick().catch((error) => logger?.error?.('[IMAGE_TO_IMAGE] worker tick failed', { errorCode: error?.code || 'IMAGE_TO_IMAGE_WORKER_FAILED' }));
  return {
    async start() {
      if (started || !config.enabled || config.workerMode !== 'embedded') return { started, enabled: config.enabled };
      worker = createImageToImageWorker({ ...dependencies, config, logger }); started = true;
      if (config.runImmediately) void tick();
      timer = timers.setInterval(tick, config.workerIntervalMs); timer.unref?.();
      return { started: true };
    },
    async stop() { if (timer) timers.clearInterval(timer); timer = null; started = false; },
    tick,
    isStarted: () => started
  };
}

module.exports = { createImageToImageRuntime };
