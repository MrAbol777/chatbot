const { createVideoGenerationWorker } = require('./video-generation.worker');

function createVideoWorkerRuntime({ config, createWorker = createVideoGenerationWorker, workerDependencies, role = 'embedded', timers = globalThis, clock = () => new Date(), logger = null }) {
  if (!config || !['embedded', 'dedicated'].includes(role)) throw new Error('A valid config and runtime role are required.');
  let worker = null; let timer = null; let tickPromise = null; let started = false;
  const state = { state: 'stopped', startedAt: null, stoppedAt: null, lastTickStartedAt: null, lastTickFinishedAt: null, lastTickDurationMs: null, lastTickClaimedCount: 0, lastTickProcessedCount: 0, lastSafeErrorCode: null, nextTickAt: null };
  const enabledForRole = () => config.enabled && config.processMode === role;
  const safeError = (error) => String(error?.code || 'VIDEO_WORKER_TICK_FAILED').slice(0, 100);
  const snapshot = () => Object.freeze({ ...state, enabled: enabledForRole(), mode: config.processMode, workerOwnerShort: String(worker?.workerId || '').slice(0, 12) || null });
  const clearTimer = () => { if (timer !== null) { timers.clearTimeout(timer); timer = null; } state.nextTickAt = null; };
  const schedule = () => {
    if (!started || state.state === 'stopping' || state.state === 'stopped' || timer !== null) return;
    state.nextTickAt = new Date(clock().getTime() + config.intervalMs);
    timer = timers.setTimeout(async () => { timer = null; await runTick(true); }, config.intervalMs);
  };
  const runTick = async (fromScheduler = false) => {
    if (!started || !worker || state.state === 'stopping' || state.state === 'stopped') return { action: 'not-running', processed: 0 };
    if (tickPromise) return { action: 'overlap-ignored', processed: 0 };
    clearTimer(); state.state = 'running'; state.lastTickStartedAt = clock();
    tickPromise = (async () => {
      try {
        const result = await worker.tick();
        state.lastTickClaimedCount = Number(result?.processed || 0);
        state.lastTickProcessedCount = Number(result?.processed || 0);
        state.lastSafeErrorCode = null;
        return result;
      } catch (error) {
        state.lastSafeErrorCode = safeError(error); state.state = 'error';
        logger?.error?.({ event: 'video_worker_tick_failed', errorCode: state.lastSafeErrorCode });
        return { action: 'error', processed: 0, errorCode: state.lastSafeErrorCode };
      } finally {
        state.lastTickFinishedAt = clock(); state.lastTickDurationMs = state.lastTickFinishedAt.getTime() - state.lastTickStartedAt.getTime(); tickPromise = null;
        if (started && state.state !== 'stopping' && state.state !== 'stopped') { state.state = 'idle'; schedule(); }
      }
    })();
    return tickPromise;
  };
  return {
    async start() {
      if (started) return { action: 'already-started', state: snapshot() };
      if (!enabledForRole()) { state.state = 'disabled'; return { action: 'disabled', state: snapshot() }; }
      worker = createWorker(workerDependencies); started = true; state.state = 'idle'; state.startedAt = clock(); state.stoppedAt = null;
      logger?.info?.({ event: 'video_worker_started', mode: role, workerOwner: String(worker.workerId || '').slice(0, 12) });
      if (config.runImmediately) void runTick(true); else schedule();
      return { action: 'started', state: snapshot() };
    },
    async stop() {
      if (!started) { if (state.state !== 'disabled') state.state = 'stopped'; return { action: 'already-stopped', state: snapshot() }; }
      state.state = 'stopping'; clearTimer(); worker?.stop?.();
      const pending = tickPromise;
      if (pending) {
        let shutdownTimer;
        try {
          await Promise.race([pending, new Promise((resolve) => { shutdownTimer = timers.setTimeout(resolve, config.shutdownTimeoutMs); })]);
        } finally {
          if (shutdownTimer !== undefined) timers.clearTimeout(shutdownTimer);
        }
      }
      started = false; state.state = 'stopped'; state.stoppedAt = clock(); logger?.info?.({ event: 'video_worker_stopped', mode: role });
      return { action: 'stopped', state: snapshot() };
    },
    isStarted: () => started,
    isTickRunning: () => Boolean(tickPromise),
    getState: snapshot,
    runTickNow: () => runTick(false)
  };
}

module.exports = { createVideoWorkerRuntime };
