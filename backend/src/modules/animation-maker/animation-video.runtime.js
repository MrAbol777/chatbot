'use strict';

function createAnimationVideoRuntime({ pipeline, intervalMs = 5_000, timers = globalThis, logger = console }) {
  let timer = null; let running = false; let stopped = true;
  const tick = async () => {
    if (running || stopped) return { processed: 0, action: running ? 'overlap-ignored' : 'stopped' };
    running = true;
    try { return await pipeline.tick(); }
    catch (error) { logger.error?.({ event: 'animation_video_pipeline_tick_failed', errorCode: error?.code || 'ANIMATION_PIPELINE_TICK_FAILED' }); return { processed: 0, action: 'error' }; }
    finally { running = false; }
  };
  return {
    async start() { if (!stopped) return; stopped = false; timer = timers.setInterval(() => { void tick(); }, intervalMs); timer?.unref?.(); void tick(); },
    async stop() { stopped = true; if (timer) timers.clearInterval(timer); timer = null; },
    tick,
    getState: () => ({ running, enabled: !stopped, intervalMs })
  };
}

module.exports = { createAnimationVideoRuntime };
