'use strict';

const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const { performance } = require('perf_hooks');

const RANGE_CONFIG = {
  '1h': { durationMs: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  '24h': { durationMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
  '30d': { durationMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 }
};

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
};

const percentile = (values, target) => {
  const items = values.map(number).filter((item) => item >= 0).sort((a, b) => a - b);
  if (items.length === 0) return 0;
  const index = Math.min(items.length - 1, Math.max(0, Math.ceil(target * items.length) - 1));
  return Math.round(items[index]);
};

const changePct = (current, previous) => {
  const before = number(previous);
  const now = number(current);
  if (before === 0) return now === 0 ? 0 : 100;
  return round(((now - before) / before) * 100, 1);
};

const safeJson = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
};

const tokenTotal = (value) => {
  const usage = safeJson(value);
  const direct = usage.total_tokens ?? usage.totalTokens ?? usage.total ?? usage.total_token_count;
  if (Number.isFinite(Number(direct))) return Number(direct);
  return number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount)
    + number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount);
};

const rowTime = (row) => new Date(row.created_at || row.createdAt || 0).getTime();

const buildTrafficSeries = (rows, from, to, bucketMs) => {
  const start = Math.floor(from.getTime() / bucketMs) * bucketMs;
  const end = to.getTime();
  const buckets = new Map();
  for (let cursor = start; cursor < end; cursor += bucketMs) {
    buckets.set(cursor, { timestamp: new Date(cursor).toISOString(), requests: 0, errors: 0, latencyTotal: 0 });
  }

  for (const row of rows) {
    const time = rowTime(row);
    if (!Number.isFinite(time)) continue;
    const key = Math.floor(time / bucketMs) * bucketMs;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.requests += 1;
    if (number(row.status_code) >= 400) bucket.errors += 1;
    bucket.latencyTotal += number(row.duration_ms);
  }

  return [...buckets.values()].map((bucket) => ({
    timestamp: bucket.timestamp,
    requests: bucket.requests,
    errorRate: bucket.requests ? round((bucket.errors / bucket.requests) * 100, 1) : 0,
    averageLatencyMs: bucket.requests ? Math.round(bucket.latencyTotal / bucket.requests) : 0
  }));
};

const summarizeRequests = (rows) => {
  const total = rows.length;
  const errors = rows.filter((row) => number(row.status_code) >= 400).length;
  const serverErrors = rows.filter((row) => number(row.status_code) >= 500).length;
  const durations = rows.map((row) => number(row.duration_ms));
  return {
    total,
    errors,
    serverErrors,
    errorRate: total ? round((errors / total) * 100, 1) : 0,
    successRate: total ? round(((total - errors) / total) * 100, 1) : 100,
    averageLatencyMs: total ? Math.round(durations.reduce((sum, item) => sum + item, 0) / total) : 0,
    p50LatencyMs: percentile(durations, 0.5),
    p95LatencyMs: percentile(durations, 0.95)
  };
};

const buildCapability = ({ key, label, rows, successStates, failureStates }) => {
  const normalizedSuccess = new Set(successStates.map((item) => item.toLowerCase()));
  const normalizedFailure = new Set(failureStates.map((item) => item.toLowerCase()));
  const total = rows.length;
  const successes = rows.filter((row) => normalizedSuccess.has(String(row.status || '').toLowerCase())).length;
  const failures = rows.filter((row) => normalizedFailure.has(String(row.status || '').toLowerCase())).length;
  const durations = rows.map((row) => number(row.duration_ms)).filter((item) => item > 0);
  return {
    key,
    label,
    total,
    successes,
    failures,
    successRate: total ? round((successes / total) * 100, 1) : 0,
    p50LatencyMs: percentile(durations, 0.5),
    p95LatencyMs: percentile(durations, 0.95)
  };
};

const buildProviderStats = ({ chatRows, imageRows, videoRows, attemptRows, healthRows }) => {
  const groups = new Map();
  const add = ({ provider, model, capability, success, latencyMs, cost, currency }) => {
    const safeProvider = String(provider || 'unknown');
    const safeModel = String(model || 'default');
    const key = `${safeProvider}:${safeModel}:${capability}`;
    const item = groups.get(key) || {
      provider: safeProvider,
      model: safeModel,
      capability,
      total: 0,
      successes: 0,
      failures: 0,
      latencyTotal: 0,
      latencyCount: 0,
      cost: 0,
      currency: currency || null
    };
    item.total += 1;
    if (success) item.successes += 1;
    else item.failures += 1;
    if (number(latencyMs) > 0) {
      item.latencyTotal += number(latencyMs);
      item.latencyCount += 1;
    }
    item.cost += number(cost);
    groups.set(key, item);
  };

  chatRows.forEach((row) => add({
    provider: 'chat', model: row.model || 'default', capability: 'chat',
    success: !row.error_code, latencyMs: row.response_time_ms
  }));
  imageRows.forEach((row) => add({
    provider: row.provider || 'image', model: row.model || 'default', capability: 'image',
    success: String(row.status).toUpperCase() === 'COMPLETED', latencyMs: row.duration_ms
  }));
  if (attemptRows.length > 0) {
    attemptRows.forEach((row) => add({
      provider: row.provider_key, model: row.internal_model_key, capability: row.capability_key || 'video',
      success: String(row.state).toLowerCase() === 'completed', latencyMs: row.processing_time_ms,
      cost: row.actual_cost, currency: row.cost_currency
    }));
  } else {
    videoRows.forEach((row) => add({
      provider: row.provider || 'video', model: row.model || 'default', capability: 'video',
      success: String(row.status).toLowerCase() === 'succeeded', latencyMs: row.duration_ms
    }));
  }

  const healthByKey = new Map(healthRows.map((row) => [
    `${row.provider_key}:${row.capability_key}`,
    row
  ]));

  return [...groups.values()]
    .map((item) => {
      const health = healthByKey.get(`${item.provider}:${item.capability}`);
      return {
        provider: item.provider,
        model: item.model,
        capability: item.capability,
        total: item.total,
        successRate: item.total ? round((item.successes / item.total) * 100, 1) : 0,
        averageLatencyMs: item.latencyCount ? Math.round(item.latencyTotal / item.latencyCount) : 0,
        cost: round(item.cost, 4),
        currency: item.currency,
        circuitState: health?.circuit_state || 'UNKNOWN'
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
};

const checkStorage = async (storagePath, label) => {
  if (!storagePath) return { key: label, label, status: 'disabled', writable: false, freePercent: null };
  try {
    await fs.access(storagePath, fsConstants.W_OK);
    let freePercent = null;
    try {
      const stats = await fs.statfs(storagePath);
      const total = number(stats.blocks) * number(stats.bsize);
      const free = number(stats.bavail) * number(stats.bsize);
      freePercent = total > 0 ? round((free / total) * 100, 1) : null;
    } catch (_) {
      freePercent = null;
    }
    return {
      key: label,
      label,
      status: freePercent != null && freePercent < 10 ? 'warning' : 'healthy',
      writable: true,
      freePercent
    };
  } catch (_) {
    return { key: label, label, status: 'critical', writable: false, freePercent: null };
  }
};

function createMonitoringService({ repository, settingsRepository = null, runtimeConfig = {}, env = process.env, clock = () => new Date() }) {
  const getOverview = async ({ range = '24h' } = {}) => {
    const safeRange = RANGE_CONFIG[range] ? range : '24h';
    const rangeConfig = RANGE_CONFIG[safeRange];
    const to = clock();
    const from = new Date(to.getTime() - rangeConfig.durationMs);
    const previousFrom = new Date(from.getTime() - rangeConfig.durationMs);
    const settings = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const errorRateThreshold = number(settings['monitoring.alert.error_rate_percent'] ?? 5);
    const p95LatencyThreshold = number(settings['monitoring.alert.p95_latency_ms'] ?? 5000);
    const minimumRequests = number(settings['monitoring.alert.minimum_requests'] ?? 20);

    const [
      totalUsers,
      activeUsers,
      previousActiveUsers,
      requestRows,
      previousRequestRows,
      chatRows,
      imageRows,
      videoRows,
      attemptRows,
      providerHealth,
      noa,
      previousNoa,
      queues,
      recentErrors,
      topErrors,
      imageStorage,
      videoStorage
    ] = await Promise.all([
      repository.getTotalUsers(),
      repository.getActiveUsers(from, to),
      repository.getActiveUsers(previousFrom, from),
      repository.getRequestRows(from, to),
      repository.getRequestRows(previousFrom, from),
      repository.getChatRows(from, to),
      repository.getImageRows(from, to),
      repository.getVideoRows(from, to),
      repository.getProviderAttempts(from, to),
      repository.getProviderHealth(),
      repository.getNoaSnapshot(from, to),
      repository.getNoaSnapshot(previousFrom, from),
      repository.getQueueSnapshot(),
      repository.getRecentErrors(from, to),
      repository.getTopErrors(from, to),
      checkStorage(runtimeConfig.ai?.image?.storageDir || env.IMAGE_STORAGE_DIR, 'imageStorage'),
      checkStorage(env.VIDEO_STORAGE_ROOT, 'videoStorage')
    ]);

    let databaseLatencyMs = 0;
    let databaseStatus = 'healthy';
    try {
      databaseLatencyMs = await repository.ping();
      if (databaseLatencyMs > 250) databaseStatus = 'warning';
    } catch (_) {
      databaseStatus = 'critical';
    }

    const requestSummary = summarizeRequests(requestRows);
    const previousRequestSummary = summarizeRequests(previousRequestRows);
    const totalTokens = chatRows.reduce((sum, row) => sum + tokenTotal(row.token_usage), 0);
    const noaSpent = noa.captured.reduce((sum, row) => sum + row.amount, 0);
    const previousNoaSpent = previousNoa.captured.reduce((sum, row) => sum + row.amount, 0);
    const chatCapabilityRows = chatRows.map((row) => ({
      ...row,
      status: row.error_code ? 'failed' : 'completed',
      duration_ms: row.response_time_ms
    }));
    const capabilities = [
      buildCapability({
        key: 'chat', label: 'گفت‌وگو', rows: chatCapabilityRows,
        successStates: ['completed'], failureStates: ['failed']
      }),
      buildCapability({
        key: 'image', label: 'تصویر', rows: imageRows,
        successStates: ['completed'], failureStates: ['error', 'cancelled']
      }),
      buildCapability({
        key: 'video', label: 'ویدیو', rows: videoRows,
        successStates: ['succeeded'], failureStates: ['failed', 'expired', 'provider_status_unknown']
      })
    ];
    const providers = buildProviderStats({ chatRows, imageRows, videoRows, attemptRows, healthRows: providerHealth });

    const health = [
      { key: 'api', label: 'API', status: 'healthy', detail: `${Math.round(process.uptime() / 60)} دقیقه uptime` },
      { key: 'database', label: 'دیتابیس', status: databaseStatus, detail: `${databaseLatencyMs} ms` },
      {
        key: 'chatProvider', label: 'ارائه‌دهنده چت',
        status: runtimeConfig.ai?.chat?.apiKeySet === false || runtimeConfig.ai?.chat?.apiKeySource === 'missing' ? 'critical' : 'healthy',
        detail: runtimeConfig.ai?.chat?.provider || 'Metis'
      },
      {
        key: 'imageProvider', label: 'ارائه‌دهنده تصویر',
        status: runtimeConfig.ai?.image?.enabled === false ? 'disabled' : 'healthy',
        detail: runtimeConfig.ai?.image?.provider || 'configured'
      },
      {
        key: 'video', label: 'ویدیو',
        status: String(env.VIDEO_GENERATION_ENABLED || '0') === '1' ? (queues.staleVideos > 0 ? 'warning' : 'healthy') : 'disabled',
        detail: String(env.VIDEO_GENERATION_ENABLED || '0') === '1' ? `${queues.staleVideos} کار گیرکرده` : 'غیرفعال'
      },
      {
        key: 'storage', label: 'فضای ذخیره‌سازی',
        status: [imageStorage.status, videoStorage.status].includes('critical') ? 'critical'
          : [imageStorage.status, videoStorage.status].includes('warning') ? 'warning' : 'healthy',
        detail: imageStorage.freePercent == null ? 'دسترسی بررسی شد' : `${imageStorage.freePercent}% آزاد`
      }
    ];

    const alerts = [];
    const addAlert = (id, severity, title, description, target) => alerts.push({ id, severity, title, description, target });
    if (databaseStatus === 'critical') addAlert('database-unavailable', 'critical', 'دیتابیس در دسترس نیست', 'پاسخ health دیتابیس ناموفق بود.', 'errors');
    if (imageStorage.status === 'critical' || videoStorage.status === 'critical') addAlert('storage-readonly', 'critical', 'Storage قابل نوشتن نیست', 'دسترسی نوشتن یکی از storageها قطع شده است.', 'config');
    if (requestSummary.total >= minimumRequests && requestSummary.errorRate >= errorRateThreshold) addAlert('high-error-rate', 'high', 'افزایش نرخ خطا', `نرخ خطای بازه جاری ${requestSummary.errorRate}% است.`, 'errors');
    if (requestSummary.total >= Math.max(5, Math.ceil(minimumRequests / 2)) && requestSummary.p95LatencyMs >= p95LatencyThreshold) addAlert('high-latency', 'warning', 'افزایش زمان پاسخ', `p95 درخواست‌ها به ${requestSummary.p95LatencyMs} میلی‌ثانیه رسیده است.`, 'errors');
    if (queues.staleVideos > 0) addAlert('stale-video-jobs', 'high', 'کار ویدیویی گیرکرده', `${queues.staleVideos} کار بیش از ۳۰ دقیقه به‌روزرسانی نشده است.`, 'videoGenerations');
    if (queues.staleImages > 0) addAlert('stale-image-jobs', 'warning', 'کار تصویری گیرکرده', `${queues.staleImages} کار بیش از ۱۵ دقیقه به‌روزرسانی نشده است.`, 'imageGenerations');
    if (noa.unresolved.total > 0) addAlert('noa-unresolved', 'high', 'رزرو نوآ منقضی شده', `${noa.unresolved.total} رزرو هنوز آزاد نشده است.`, 'noaFinance');
    providerHealth.filter((row) => row.circuit_state === 'OPEN').forEach((row) => {
      addAlert(`provider-open-${row.provider_key}-${row.capability_key}`, 'high', 'مدار Provider باز است', `${row.provider_key} برای ${row.capability_key} موقتاً متوقف شده است.`, 'aiRouting');
    });

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptimeSeconds = Math.max(1, process.uptime());
    const eventLoop = performance.eventLoopUtilization();
    return {
      meta: {
        range: safeRange,
        from: from.toISOString(),
        to: to.toISOString(),
        generatedAt: to.toISOString(),
        bucketSeconds: rangeConfig.bucketMs / 1000,
        environment: env.NODE_ENV || 'development',
        requestMetricsSampled: requestRows.length >= 50000,
        thresholds: {
          errorRatePercent: errorRateThreshold,
          p95LatencyMs: p95LatencyThreshold,
          minimumRequests
        }
      },
      health,
      kpis: {
        totalUsers,
        activeUsers: { value: activeUsers, changePct: changePct(activeUsers, previousActiveUsers) },
        requests: { value: requestSummary.total, changePct: changePct(requestSummary.total, previousRequestSummary.total) },
        successRate: { value: requestSummary.successRate, changePct: round(requestSummary.successRate - previousRequestSummary.successRate, 1) },
        errorRate: { value: requestSummary.errorRate, changePct: round(requestSummary.errorRate - previousRequestSummary.errorRate, 1) },
        p95LatencyMs: { value: requestSummary.p95LatencyMs, changePct: changePct(requestSummary.p95LatencyMs, previousRequestSummary.p95LatencyMs) },
        noaSpent: { value: round(noaSpent, 3), changePct: changePct(noaSpent, previousNoaSpent) },
        tokens: { value: Math.round(totalTokens), source: 'recorded' }
      },
      traffic: buildTrafficSeries(requestRows, from, to, rangeConfig.bucketMs),
      capabilities,
      providers,
      queues,
      noa,
      storage: { image: imageStorage, video: videoStorage },
      alerts,
      recentErrors: recentErrors.map((row) => ({
        type: row.error_type,
        endpoint: row.endpoint,
        statusCode: row.status_code == null ? null : Number(row.status_code),
        createdAt: row.created_at
      })),
      topErrors: topErrors.map((row) => ({ type: row.error_type || 'unknown', total: Number(row.total || 0) })),
      process: {
        uptimeSeconds: Math.round(uptimeSeconds),
        rssMb: round(memory.rss / 1024 / 1024, 1),
        heapUsedMb: round(memory.heapUsed / 1024 / 1024, 1),
        cpuPercent: round(((cpu.user + cpu.system) / 1_000_000 / uptimeSeconds) * 100, 1),
        eventLoopUtilizationPercent: round(number(eventLoop.utilization) * 100, 1),
        nodeVersion: process.version
      }
    };
  };

  return { getOverview };
}

module.exports = {
  RANGE_CONFIG,
  buildTrafficSeries,
  createMonitoringService,
  percentile,
  summarizeRequests,
  tokenTotal
};
