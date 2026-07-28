'use strict';

// Loaded only by the video-generation test scripts. It makes an accidental
// provider/download request fail before a socket is opened; loopback remains
// available for the explicit local HTTP fixtures.
if (process.env.NODE_ENV !== 'test') process.env.NODE_ENV = 'test';

const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

function loopback(host) {
  const value = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return value === 'localhost' || value === '::1' || (net.isIP(value) === 4 && value.startsWith('127.'));
}

function requestedHost(args) {
  const first = args[0];
  if (first instanceof URL) return first.hostname;
  if (typeof first === 'string') {
    try { return new URL(first).hostname; } catch (_) { return null; }
  }
  return first?.hostname || first?.host?.split(':')[0] || null;
}

function guard(client, protocol) {
  const originalRequest = client.request.bind(client);
  client.request = (...args) => {
    const host = requestedHost(args);
    if (host && !loopback(host)) throw new Error(`External ${protocol} network is blocked in video-generation tests.`);
    return originalRequest(...args);
  };
  client.get = (...args) => {
    const request = client.request(...args);
    request.end();
    return request;
  };
}

guard(http, 'HTTP');
guard(https, 'HTTPS');

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const host = options && typeof options === 'object'
    ? options.host || options.hostname
    : typeof args[1] === 'string' ? args[1] : null;
  // Named pipes and omitted hosts are local transports. Every explicit
  // non-loopback TCP destination fails before a socket can be opened.
  if (host && !loopback(host)) throw new Error('External TCP network is blocked in video-generation tests.');
  return originalSocketConnect.apply(this, args);
};

if (typeof global.fetch === 'function') {
  const originalFetch = global.fetch.bind(global);
  global.fetch = (input, init) => {
    const host = requestedHost([input]);
    if (host && !loopback(host)) return Promise.reject(new Error('External fetch network is blocked in video-generation tests.'));
    return originalFetch(input, init);
  };
}
