const DEFAULTS = Object.freeze({
  enabled: false,
  processMode: 'disabled',
  runImmediately: false,
  intervalMs: 30_000,
  shutdownTimeoutMs: 10_000,
  batchSize: 5,
  leaseMs: 60_000,
  // BananaAI generation is asynchronous and can legitimately take several
  // minutes. The job timeout below is the single authoritative deadline;
  // keep this optional escape hatch disabled by default.
  providerDeadlineSeconds: 0,
  jobTimeoutMinutes: 30,
  maxPollAttempts: 20,
  pollBaseDelayMs: 5_000,
  pollMaxDelayMs: 60_000
});

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return parsed;
}

function boolean(value, name, fallback = DEFAULTS.enabled) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function processMode(value) {
  const mode = String(value || DEFAULTS.processMode).toLowerCase();
  if (!['disabled', 'embedded', 'dedicated'].includes(mode)) {
    throw new Error('VIDEO_WORKER_PROCESS_MODE must be disabled, embedded, or dedicated.');
  }
  return mode;
}

function loadVideoWorkerConfig(env = process.env) {
  const selectedMode = processMode(env.VIDEO_GENERATION_WORKER_MODE ?? env.VIDEO_WORKER_PROCESS_MODE);
  const config = {
    enabled: boolean(env.VIDEO_GENERATION_WORKER_ENABLED ?? env.VIDEO_WORKER_ENABLED, 'VIDEO_GENERATION_WORKER_ENABLED', selectedMode !== 'disabled'),
    processMode: selectedMode,
    runImmediately: boolean(env.VIDEO_GENERATION_WORKER_RUN_IMMEDIATELY ?? env.VIDEO_WORKER_RUN_IMMEDIATELY, 'VIDEO_GENERATION_WORKER_RUN_IMMEDIATELY', DEFAULTS.runImmediately),
    intervalMs: positiveInteger(env.VIDEO_GENERATION_WORKER_INTERVAL_MS || env.VIDEO_WORKER_INTERVAL_MS || DEFAULTS.intervalMs, 'VIDEO_GENERATION_WORKER_INTERVAL_MS'),
    shutdownTimeoutMs: positiveInteger(env.VIDEO_GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS || env.VIDEO_WORKER_SHUTDOWN_TIMEOUT_MS || DEFAULTS.shutdownTimeoutMs, 'VIDEO_GENERATION_WORKER_SHUTDOWN_TIMEOUT_MS'),
    batchSize: positiveInteger(env.VIDEO_GENERATION_WORKER_BATCH_SIZE || env.VIDEO_WORKER_BATCH_SIZE || DEFAULTS.batchSize, 'VIDEO_GENERATION_WORKER_BATCH_SIZE'),
    leaseMs: positiveInteger(env.VIDEO_GENERATION_WORKER_LEASE_MS || env.VIDEO_WORKER_LEASE_MS || DEFAULTS.leaseMs, 'VIDEO_GENERATION_WORKER_LEASE_MS'),
    providerDeadlineSeconds: env.VIDEO_PROVIDER_DEADLINE_SECONDS === undefined || env.VIDEO_PROVIDER_DEADLINE_SECONDS === ''
      ? DEFAULTS.providerDeadlineSeconds
      : nonNegativeInteger(env.VIDEO_PROVIDER_DEADLINE_SECONDS, 'VIDEO_PROVIDER_DEADLINE_SECONDS'),
    jobTimeoutMinutes: positiveInteger(env.VIDEO_JOB_TIMEOUT_MINUTES || DEFAULTS.jobTimeoutMinutes, 'VIDEO_JOB_TIMEOUT_MINUTES'),
    maxPollAttempts: positiveInteger(env.VIDEO_GENERATION_WORKER_MAX_ATTEMPTS || env.VIDEO_MAX_POLL_ATTEMPTS || DEFAULTS.maxPollAttempts, 'VIDEO_GENERATION_WORKER_MAX_ATTEMPTS'),
    pollBaseDelayMs: positiveInteger(env.VIDEO_POLL_BASE_DELAY_MS || DEFAULTS.pollBaseDelayMs, 'VIDEO_POLL_BASE_DELAY_MS'),
    pollMaxDelayMs: positiveInteger(env.VIDEO_POLL_MAX_DELAY_MS || DEFAULTS.pollMaxDelayMs, 'VIDEO_POLL_MAX_DELAY_MS')
  };
  if (config.pollMaxDelayMs < config.pollBaseDelayMs) {
    throw new Error('VIDEO_POLL_MAX_DELAY_MS must be greater than or equal to VIDEO_POLL_BASE_DELAY_MS.');
  }
  if (config.batchSize > 100) throw new Error('VIDEO_WORKER_BATCH_SIZE must not exceed 100.');
  if (config.enabled && config.processMode !== 'disabled' && config.leaseMs < config.intervalMs) throw new Error('VIDEO_WORKER_LEASE_MS must be greater than or equal to VIDEO_WORKER_INTERVAL_MS.');
  if (config.shutdownTimeoutMs > 120_000) throw new Error('VIDEO_WORKER_SHUTDOWN_TIMEOUT_MS must not exceed 120000.');
  return Object.freeze(config);
}

function calculatePollDelay(attempt, config) {
  const safeAttempt = Math.max(0, Number.isSafeInteger(Number(attempt)) ? Number(attempt) : 0);
  // Cap the exponent before calculating it, so an untrusted DB value cannot overflow.
  const maxExponent = Math.max(0, Math.floor(Math.log2(config.pollMaxDelayMs / config.pollBaseDelayMs)));
  return Math.min(config.pollMaxDelayMs, config.pollBaseDelayMs * (2 ** Math.min(safeAttempt, maxExponent)));
}

module.exports = { DEFAULTS, loadVideoWorkerConfig, calculatePollDelay };
