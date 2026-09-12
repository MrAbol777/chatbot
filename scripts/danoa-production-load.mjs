import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.DANOA_TARGET_URL || 'https://danoa.ir').replace(/\/$/, '');
const runId = process.env.DANOA_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const stages = (process.env.DANOA_STAGES || '100,500,1000,2000,3000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const requestTimeoutMs = Number(process.env.DANOA_REQUEST_TIMEOUT_MS || 15000);
const hardStopErrorRate = Number(process.env.DANOA_MAX_ERROR_RATE || 0.02);
const hardStopP95Ms = Number(process.env.DANOA_MAX_P95_MS || 3000);

function percentile(values, p) {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return [...values].sort((a, b) => a - b)[index];
}

async function requestJson(pathname, { method = 'GET', body, token } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    const latencyMs = performance.now() - started;
    let json = null;
    try { json = await response.json(); } catch { /* metrics only */ }
    return { ok: response.ok, status: response.status, latencyMs, json };
  } catch (error) {
    return { ok: false, status: error?.name === 'AbortError' ? 0 : -1, latencyMs: performance.now() - started, error: error?.name || 'request_error' };
  } finally {
    clearTimeout(timeout);
  }
}

function summarise(name, results) {
  const latencies = results.map((result) => result.latencyMs);
  const ok = results.filter((result) => result.ok).length;
  const elapsedMs = Math.max(...latencies, 1);
  const statusCounts = Object.fromEntries(
    [...new Set(results.map((result) => String(result.status)))].sort().map((status) => [status, results.filter((result) => String(result.status) === status).length])
  );
  return {
    name,
    requests: results.length,
    successful: ok,
    failed: results.length - ok,
    errorRate: Number(((results.length - ok) / Math.max(results.length, 1)).toFixed(4)),
    latencyMs: {
      min: Number(Math.min(...latencies).toFixed(1)),
      p50: Number(percentile(latencies, 0.5).toFixed(1)),
      p95: Number(percentile(latencies, 0.95).toFixed(1)),
      p99: Number(percentile(latencies, 0.99).toFixed(1)),
      max: Number(Math.max(...latencies).toFixed(1))
    },
    burstThroughputRps: Number((results.length / (elapsedMs / 1000)).toFixed(2)),
    statusCounts
  };
}

async function burst(items, fn) {
  return Promise.all(items.map(fn));
}

const report = {
  runId,
  target: baseUrl,
  startedAt: new Date().toISOString(),
  requestTimeoutMs,
  stages: [],
  stoppedEarly: false,
  stopReason: null
};

for (const concurrency of stages) {
  const userNumbers = Array.from({ length: concurrency }, (_, index) => index + 1);
  const loginResults = await burst(userNumbers, async (number) => {
    const phone = `0997000${String(number).padStart(4, '0')}`;
    return requestJson('/api/verify-code', {
      method: 'POST',
      body: { phone, code: '739251', mode: 'login' }
    });
  });
  const login = summarise('otp_login', loginResults);
  const tokens = loginResults.map((result) => result.json?.token).filter((token) => typeof token === 'string' && token.length > 20);
  const sessionResults = await burst(tokens, (token) => requestJson('/api/auth/session', { token }));
  const session = summarise('authenticated_session', sessionResults);
  const conversationsResults = await burst(tokens, (token) => requestJson('/api/conversations/load', {
    method: 'POST',
    body: { profile: {} },
    token
  }));
  const conversations = summarise('conversations_load', conversationsResults);
  const stage = { concurrency, tokensReceived: tokens.length, login, session, conversations };
  report.stages.push(stage);
  process.stdout.write(`${JSON.stringify(stage)}\n`);

  const breach = [login, session, conversations].find((metric) =>
    metric.errorRate > hardStopErrorRate || metric.latencyMs.p95 > hardStopP95Ms
  );
  if (tokens.length !== concurrency || breach) {
    report.stoppedEarly = true;
    report.stopReason = tokens.length !== concurrency
      ? `Only ${tokens.length}/${concurrency} login tokens were issued.`
      : `${breach.name}: errorRate=${breach.errorRate}, p95=${breach.latencyMs.p95}ms`;
    break;
  }
}

report.finishedAt = new Date().toISOString();
fs.mkdirSync(path.resolve('output'), { recursive: true });
const outputFile = path.resolve('output', `danoa-production-load-${runId}.json`);
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
process.stdout.write(`REPORT_FILE=${outputFile}\n`);
