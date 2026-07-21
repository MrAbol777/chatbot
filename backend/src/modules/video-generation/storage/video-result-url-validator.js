const dns = require('dns');
const net = require('net');
const { VideoStorageError } = require('./video-storage.errors');

const IPV4_BLOCKS = Object.freeze([
  [0x00000000, 0xff000000], [0x0a000000, 0xff000000], [0x64400000, 0xffc00000],
  [0x7f000000, 0xff000000], [0xa9fe0000, 0xffff0000], [0xac100000, 0xfff00000],
  [0xc0000000, 0xffffff00], [0xc0000200, 0xffffff00], [0xc0a80000, 0xffff0000],
  [0xc6120000, 0xfffe0000], [0xc6336400, 0xffffff00], [0xcb007100, 0xffffff00],
  [0xe0000000, 0xf0000000], [0xf0000000, 0xf0000000]
]);

function ipv4Number(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => (result * 256) + Number(part), 0);
}

function isBlockedIpv4(value) {
  const number = ipv4Number(value);
  return number === null || IPV4_BLOCKS.some(([network, mask]) => (number & mask) === (network & mask));
}

function ipv6BigInt(value) {
  let source = String(value).toLowerCase();
  if (source.includes('%')) return null;
  const ipv4Index = source.lastIndexOf(':');
  if (source.includes('.')) {
    const ipv4 = ipv4Number(source.slice(ipv4Index + 1));
    if (ipv4 === null) return null;
    source = `${source.slice(0, ipv4Index)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (left.length + right.length > 8 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Range(number, network, prefix) {
  const bits = 128n; const mask = ((1n << BigInt(prefix)) - 1n) << (bits - BigInt(prefix));
  return (number & mask) === (network & mask);
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family !== 6) return true;
  const number = ipv6BigInt(address);
  if (number === null) return true;
  // IPv4-mapped IPv6 must observe the exact IPv4 policy too.
  if ((number >> 32n) === 0xffffn) {
    const mapped = Number(number & 0xffffffffn);
    return isBlockedIpv4(`${(mapped >>> 24) & 255}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`);
  }
  return number === 0n || number === 1n
    || inIpv6Range(number, 0xfc00n << 112n, 7)
    || inIpv6Range(number, 0xfe80n << 112n, 10)
    || inIpv6Range(number, 0xff00n << 112n, 8)
    || inIpv6Range(number, 0x20010db8n << 96n, 32);
}

function normalizeHost(value) {
  const raw = String(value || '').trim().replace(/\.+$/, '');
  if (!raw || /[\r\n/@?#]/.test(raw)) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
  // URL performs the same IDNA/punycode normalization used for download URLs.
  // Normalizing config entries this way prevents a Unicode allowlist entry from
  // silently failing to match its equivalent ASCII hostname.
  let host;
  try { host = new URL(`https://${raw}`).hostname.replace(/\.+$/, '').toLowerCase(); } catch (_) { throw new VideoStorageError('VIDEO_RESULT_URL_INVALID'); }
  if (!host) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
  return host;
}

function normalizeAllowedHosts(hosts) {
  return [...new Set((Array.isArray(hosts) ? hosts : []).map(normalizeHost))];
}

function isAllowedHost(host, allowedHosts) {
  return allowedHosts.includes(host);
}

function isTestLocalAllowed({ protocol, host, port, allowTestLocal, allowedHosts, allowedPorts }) {
  return process.env.NODE_ENV === 'test' && allowTestLocal === true
    && (protocol === 'http:' || protocol === 'https:')
    && allowedHosts.includes(host)
    && (host === 'localhost' || net.isIP(host))
    && allowedPorts.includes(port);
}

function createVideoResultUrlValidator({ allowedHosts = [], allowedPorts = [443], allowedPathPrefixes = ['/'], allowTestLocal = false, resolver = dns.promises.lookup } = {}) {
  const hosts = normalizeAllowedHosts(allowedHosts);
  const ports = [...new Set((Array.isArray(allowedPorts) ? allowedPorts : [443]).map(Number))].filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  const prefixes = [...new Set((Array.isArray(allowedPathPrefixes) ? allowedPathPrefixes : []).map((value) => String(value || '').trim()).filter((value) => value.startsWith('/') && !value.includes('..') && !/[?#\\]/.test(value)).map((value) => value.endsWith('/') ? value : `${value}/`))];
  async function validate(value, { base = null } = {}) {
    const raw = String(value || '');
    if (!raw || /[\r\n]/.test(raw) || /%2e|%2f|%5c/i.test(raw)) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
    let url;
    try { url = base ? new URL(raw, base) : new URL(raw); } catch (_) { throw new VideoStorageError('VIDEO_RESULT_URL_INVALID'); }
    if (!base && !/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
    if (url.username || url.password) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
    if (url.hash || /%2e|%2f|%5c/i.test(url.pathname)) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
    const hostname = normalizeHost(url.hostname);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : 0));
    const testLocal = isTestLocalAllowed({ protocol: url.protocol, host: hostname, port, allowTestLocal, allowedHosts: hosts, allowedPorts: ports });
    if ((url.protocol !== 'https:' && !testLocal) || !ports.includes(port)) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
    if (!hosts.length || !isAllowedHost(hostname, hosts)) throw new VideoStorageError('VIDEO_RESULT_HOST_NOT_ALLOWED');
    if (!prefixes.some((prefix) => url.pathname.startsWith(prefix))) throw new VideoStorageError('VIDEO_RESULT_PATH_NOT_ALLOWED');
    const literalFamily = net.isIP(hostname);
    if (literalFamily && !testLocal) throw new VideoStorageError('VIDEO_RESULT_PRIVATE_ADDRESS_BLOCKED');
    let records;
    try {
      records = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolver(hostname, { all: true, verbatim: true });
    } catch (_) { throw new VideoStorageError('VIDEO_RESULT_URL_INVALID'); }
    if (!Array.isArray(records) || !records.length || records.some((record) => !record?.address || !net.isIP(record.address))) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
    if (records.some((record) => isBlockedAddress(record.address)) && !testLocal) throw new VideoStorageError('VIDEO_RESULT_PRIVATE_ADDRESS_BLOCKED');
    return Object.freeze({ url, hostname, port, records: records.map((record) => ({ address: record.address, family: net.isIP(record.address) })), testLocal });
  }
  return { validate, allowedHosts: hosts, allowedPorts: ports, allowedPathPrefixes: prefixes };
}

function createPinnedLookup(records) {
  const entries = Array.isArray(records) ? records : [];
  return (_hostname, options, callback) => {
    const family = typeof options === 'object' ? Number(options.family || 0) : 0;
    const matching = entries.filter((entry) => !family || entry.family === family);
    if (typeof options === 'object' && options.all) {
      if (!matching.length) return callback(Object.assign(new Error('No validated address is available.'), { code: 'VIDEO_RESULT_DNS_REBIND_BLOCKED' }));
      return callback(null, matching.map((entry) => ({ address: entry.address, family: entry.family })));
    }
    const record = matching[0] || entries[0];
    if (!record) return callback(Object.assign(new Error('No validated address is available.'), { code: 'VIDEO_RESULT_DNS_REBIND_BLOCKED' }));
    callback(null, record.address, record.family);
  };
}

module.exports = { createVideoResultUrlValidator, createPinnedLookup, isBlockedAddress, normalizeHost };
