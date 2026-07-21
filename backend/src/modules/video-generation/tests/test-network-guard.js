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
