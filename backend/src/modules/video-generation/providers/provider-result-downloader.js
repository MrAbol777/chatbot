'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');
const { Transform } = require('stream');
const { fetchValidatedResult } = require('./metis-video.provider');
const { createPinnedLookup } = require('../storage/video-result-url-validator');
const { fail } = require('../video-generation.errors');
const { VideoStorageError } = require('../storage/video-storage.errors');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function validateProviderBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
  return url.origin;
}

function resultError(code, { retryable = false, cause = null } = {}) {
  const error = new VideoStorageError(code, undefined, { retryable });
  if (cause) {
    error.cause = cause;
    error.underlyingCode = String(cause.code || '').slice(0, 100) || null;
    error.underlyingName = String(cause.name || '').slice(0, 100) || null;
  }
  return error;
}

function classifyDownloadError(error, phase = 'network') {
  if (error instanceof VideoStorageError) return error;
  const code = String(error?.code || '').toUpperCase();
  if (['VIDEO_RESULT_CONNECT_TIMEOUT', 'VIDEO_RESULT_HEADERS_TIMEOUT', 'VIDEO_RESULT_IDLE_TIMEOUT', 'VIDEO_RESULT_TOTAL_TIMEOUT'].includes(code)) return resultError(code, { retryable: true, cause: error });
  if (code === 'EAI_AGAIN') return resultError('VIDEO_RESULT_DNS_TEMPORARY_FAILURE', { retryable: true, cause: error });
  if (code === 'ENOTFOUND') return resultError('VIDEO_RESULT_DNS_NOT_FOUND', { retryable: false, cause: error });
  if (['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code)) return resultError('VIDEO_RESULT_CONNECTION_RESET', { retryable: true, cause: error });
  if (code === 'ETIMEDOUT') return resultError(phase === 'connect' ? 'VIDEO_RESULT_CONNECT_TIMEOUT' : 'VIDEO_RESULT_NETWORK_TIMEOUT', { retryable: true, cause: error });
  if (/^(ERR_TLS|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_)/.test(code)) return resultError('VIDEO_RESULT_TLS_FAILURE', { retryable: false, cause: error });
  return resultError('VIDEO_RESULT_NETWORK_ERROR', { retryable: true, cause: error });
}

function contentLength(value, maxBytes) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d+$/.test(String(value).trim())) throw resultError('VIDEO_RESULT_INVALID_CONTENT_LENGTH');
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > Number(maxBytes)) throw resultError('VIDEO_RESULT_TOO_LARGE');
  return length;
}

function contentType(response) {
  const raw = response.headers?.['content-type'];
  if (Array.isArray(raw) || !raw) return null;
  const mimeType = String(raw).split(';')[0].trim().toLowerCase();
  return mimeType || null;
}

function proxyConfig(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch (_) { throw resultError('VIDEO_RESULT_PROXY_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) throw resultError('VIDEO_RESULT_PROXY_INVALID');
  return { protocol: url.protocol, hostname: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), authorization: url.username || url.password ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}` : null };
}

function safeRemote(plan) { return { hostname: plan.hostname, path: plan.url.pathname }; }
function timeoutError(code) { return Object.assign(new Error(code), { code }); }
function createDeadline(timeoutMs, onTimeout) {
  const value = Number(timeoutMs || 0);
  if (!Number.isFinite(value) || value <= 0) return () => {};
  const timer = setTimeout(() => onTimeout(timeoutError('VIDEO_RESULT_TOTAL_TIMEOUT')), value);
  timer.unref?.();
  return () => clearTimeout(timer);
}

function waitForSocket(socket, event, timeoutMs, timeoutCode) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => { if (timer) clearTimeout(timer); socket.removeListener(event, done); socket.removeListener('error', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = (error) => { cleanup(); reject(error); };
    socket.once(event, done); socket.once('error', failed);
    timer = setTimeout(() => socket.destroy(timeoutError(timeoutCode)), Number(timeoutMs));
    timer.unref?.();
  });
}

function requestWithTimers(client, options, { connectTimeoutMs, headersTimeoutMs, totalTimeoutMs, createConnection = null }) {
  return new Promise((resolve, reject) => {
    let settled = false; let headersTimer = null; let connectTimer = null; let request;
    const clearTimers = () => { if (connectTimer) clearTimeout(connectTimer); if (headersTimer) clearTimeout(headersTimer); clearTotalTimeout(); };
    const finish = (callback) => (value) => { if (settled) return; settled = true; clearTimers(); callback(value); };
    const failRequest = finish((error) => reject(classifyDownloadError(error)));
    const clearTotalTimeout = createDeadline(totalTimeoutMs, (error) => request?.destroy(error));
    try {
      request = client.request({ ...options, ...(createConnection ? { createConnection, agent: false } : {}) }, finish((response) => resolve(response)));
      request.once('error', failRequest);
      request.once('socket', (socket) => {
        const secureEvent = options.protocol === 'https:' ? 'secureConnect' : 'connect';
        const connected = options.protocol === 'https:' ? socket.encrypted && !socket.connecting : !socket.connecting;
        const startHeaders = () => { headersTimer = setTimeout(() => request.destroy(timeoutError('VIDEO_RESULT_HEADERS_TIMEOUT')), Number(headersTimeoutMs)); headersTimer.unref?.(); };
        if (connected) return startHeaders();
        connectTimer = setTimeout(() => request.destroy(timeoutError('VIDEO_RESULT_CONNECT_TIMEOUT')), Number(connectTimeoutMs)); connectTimer.unref?.();
        socket.once(secureEvent, () => { if (connectTimer) clearTimeout(connectTimer); startHeaders(); });
      });
      request.end();
    } catch (error) { failRequest(error); }
  });
}

function openProxyTunnel(plan, proxy, timeouts) {
  return new Promise((resolve, reject) => {
    const client = proxy.protocol === 'https:' ? https : http;
    const request = client.request({ protocol: proxy.protocol, hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: `${plan.hostname}:${plan.port}`, headers: { Host: `${plan.hostname}:${plan.port}`, ...(proxy.authorization ? { 'Proxy-Authorization': proxy.authorization } : {}) } });
    const timer = setTimeout(() => request.destroy(timeoutError('VIDEO_RESULT_CONNECT_TIMEOUT')), Number(timeouts.connectTimeoutMs)); timer.unref?.();
    request.once('error', (error) => { clearTimeout(timer); reject(classifyDownloadError(error, 'connect')); });
    request.once('connect', (response, socket, head) => {
      clearTimeout(timer);
      if (response.statusCode !== 200 || head?.length) { socket.destroy(); return reject(resultError('VIDEO_RESULT_PROXY_CONNECT_FAILED', { retryable: Number(response.statusCode) >= 500 })); }
      resolve(socket);
    });
    request.end();
  });
}

async function requestValidatedNode(plan, options) {
  const proxy = proxyConfig(options.proxyUrl);
  const records = options.forceIpv4 === false ? plan.records : plan.records.filter((record) => record.family === 4);
  if (!records.length) throw resultError('VIDEO_RESULT_DNS_NOT_FOUND');
  const requestOptions = { protocol: plan.url.protocol, hostname: plan.hostname, port: plan.port, path: `${plan.url.pathname}${plan.url.search}`, method: 'GET', headers: { Accept: 'video/mp4, video/webm', 'Accept-Encoding': 'identity', Host: plan.hostname }, lookup: createPinnedLookup(records), servername: plan.hostname };
  if (!proxy) return requestWithTimers(plan.url.protocol === 'https:' ? https : http, requestOptions, options);
  const tunnel = await openProxyTunnel(plan, proxy, options);
  let socket = tunnel;
  if (plan.url.protocol === 'https:') { socket = tls.connect({ socket: tunnel, servername: plan.hostname }); await waitForSocket(socket, 'secureConnect', options.connectTimeoutMs, 'VIDEO_RESULT_CONNECT_TIMEOUT'); }
  return requestWithTimers(plan.url.protocol === 'https:' ? https : http, requestOptions, options, () => socket);
}

function createIntegrityStream(response, { expectedLength, idleTimeoutMs, metrics, clearTotalTimeout }) {
  let idleTimer = null;
  const clearIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = null; };
  let stream;
  const armIdle = () => { clearIdle(); idleTimer = setTimeout(() => stream.destroy(classifyDownloadError(timeoutError('VIDEO_RESULT_IDLE_TIMEOUT'))), Number(idleTimeoutMs)); idleTimer.unref?.(); };
  stream = new Transform({
    transform(chunk, _encoding, callback) { metrics.receivedBytes += chunk.length; armIdle(); callback(null, chunk); },
    flush(callback) { clearIdle(); clearTotalTimeout(); if (expectedLength !== null && metrics.receivedBytes !== expectedLength) return callback(resultError('VIDEO_RESULT_INCOMPLETE_BODY', { retryable: true })); if (metrics.receivedBytes === 0) return callback(resultError('VIDEO_RESULT_EMPTY_RESPONSE')); callback(); }
  });
  stream.once('error', () => { clearIdle(); clearTotalTimeout(); });
  stream.once('close', () => { clearIdle(); clearTotalTimeout(); });
  armIdle();
  response.once('error', (error) => stream.destroy(classifyDownloadError(error)));
  response.pipe(stream);
  return stream;
}

async function fetchValidatedResultWithNode(source, { validator, maxBytes, maxRedirects = 0, connectTimeoutMs = 15_000, headersTimeoutMs = 30_000, idleTimeoutMs = 90_000, totalTimeoutMs = 0, proxyUrl = null, forceIpv4 = true, requestImpl = requestValidatedNode, logger = null, context = null }) {
  let plan = await validator.validate(source);
  const redirects = Number(maxRedirects);
  if (!Number.isSafeInteger(redirects) || redirects < 0 || redirects > 5) throw resultError('VIDEO_RESULT_TOO_MANY_REDIRECTS');
  const startedAt = Date.now();
  const metadata = { ...(context || {}), ...safeRemote(plan), proxyUsed: Boolean(String(proxyUrl || '').trim()), redirectCount: 0, receivedBytes: 0 };
  logger?.info?.({ event: 'video_result_download_started', ...metadata });
  for (let redirectCount = 0; redirectCount <= redirects; redirectCount += 1) {
    let response;
    try { response = await requestImpl(plan, { connectTimeoutMs, headersTimeoutMs, idleTimeoutMs, totalTimeoutMs, proxyUrl, forceIpv4 }); }
    catch (error) { const classified = classifyDownloadError(error); logger?.warn?.({ event: 'video_result_download_failed', ...metadata, elapsedMs: Date.now() - startedAt, errorCode: classified.code, underlyingCode: classified.underlyingCode, underlyingName: classified.underlyingName, retryable: classified.retryable }); throw classified; }
    const status = Number(response.statusCode || 0);
    if (REDIRECT_STATUSES.has(status)) {
      const location = response.headers?.location; response.resume?.();
      if (!location || Array.isArray(location) || redirectCount >= redirects) throw resultError('VIDEO_RESULT_TOO_MANY_REDIRECTS');
      try { plan = await validator.validate(location, { base: plan.url }); } catch (error) { throw resultError('VIDEO_RESULT_REDIRECT_BLOCKED', { cause: error }); }
      metadata.hostname = plan.hostname; metadata.path = plan.url.pathname; metadata.redirectCount = redirectCount + 1; continue;
    }
    if (status < 200 || status >= 300) {
      response.resume?.();
      const code = status === 403 ? 'VIDEO_RESULT_PROVIDER_FORBIDDEN' : status === 404 ? 'VIDEO_RESULT_PROVIDER_NOT_FOUND' : status === 429 ? 'VIDEO_RESULT_PROVIDER_RATE_LIMITED' : status >= 500 ? 'VIDEO_RESULT_PROVIDER_TEMPORARY' : 'VIDEO_RESULT_PROVIDER_HTTP_ERROR';
      const retryable = status === 403 || status === 429 || status >= 500;
      const error = resultError(code, { retryable }); logger?.warn?.({ event: 'video_result_download_failed', ...metadata, status, elapsedMs: Date.now() - startedAt, errorCode: code, retryable }); throw error;
    }
    if (!response.readable) throw resultError('VIDEO_RESULT_EMPTY_RESPONSE');
    const expectedLength = contentLength(response.headers?.['content-length'], maxBytes);
    const mimeType = contentType(response); const metrics = metadata;
    metrics.contentLength = expectedLength; metrics.httpStatus = status;
    logger?.info?.({ event: 'video_result_download_headers', ...metrics, mimeType });
    const clearTotalTimeout = createDeadline(totalTimeoutMs, (error) => response.destroy(error));
    const stream = createIntegrityStream(response, { expectedLength, idleTimeoutMs, metrics, clearTotalTimeout });
    stream.once('end', () => logger?.info?.({ event: 'video_result_download_completed', ...metrics, elapsedMs: Date.now() - startedAt, mimeType }));
    stream.once('error', (error) => { const classified = classifyDownloadError(error); logger?.warn?.({ event: 'video_result_download_failed', ...metrics, elapsedMs: Date.now() - startedAt, errorCode: classified.code, underlyingCode: classified.underlyingCode, underlyingName: classified.underlyingName, retryable: classified.retryable }); });
    return { stream, mimeType, finalUrl: plan.url, contentLength: expectedLength, metrics };
  }
  throw resultError('VIDEO_RESULT_TOO_MANY_REDIRECTS');
}

module.exports = { fetchValidatedResult, fetchValidatedResultWithNode, validateProviderBaseUrl, classifyDownloadError, contentLength, proxyConfig };
