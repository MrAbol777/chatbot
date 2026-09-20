'use strict';

const dns = require('dns');
const https = require('https');

let initialized = false;
const dnsCache = new Map();

/**
 * Perform a lightweight DNS over HTTPS (DoH) lookup as a fallback
 * when local system DNS cannot resolve Iranian or other external domains.
 */
function queryDoH(hostname, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
      { headers: { Accept: 'application/dns-json' }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const answer = parsed.Answer?.find((a) => a.type === 1);
            if (answer && answer.data) {
              resolve(answer.data);
            } else {
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('DOH_TIMEOUT'));
    });
  });
}

function parseHostOverrides(envStr) {
  const map = {};
  if (typeof envStr !== 'string') return map;
  const items = envStr.split(/[,;\s]+/);
  for (const item of items) {
    const [host, ip] = item.split(/[=:]/);
    if (host && ip) {
      map[host.trim().toLowerCase()] = ip.trim();
    }
  }
  return map;
}

/**
 * Initialize DNS resilience and fallback layer.
 * Patches dns.lookup globally so all outgoing HTTP/HTTPS/axios/fetch requests
 * can resolve known services even if the local host DNS fails to resolve .ir domains.
 */
function initDns({ env = process.env, logger = console } = {}) {
  if (initialized) return;
  initialized = true;

  const defaultOverrides = {
    'api.metisai.ir': '45.94.254.27',
    'bananaai.ir': '91.107.177.47',
    'vianaland.ir': '185.143.234.130'
  };

  const overrides = {
    ...defaultOverrides,
    ...(env.METIS_IP ? { 'api.metisai.ir': env.METIS_IP } : {}),
    ...parseHostOverrides(env.DNS_HOST_OVERRIDES)
  };

  for (const [h, ip] of Object.entries(overrides)) {
    dnsCache.set(h, ip);
  }

  const originalLookup = dns.lookup;

  dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';

    if (dnsCache.has(host)) {
      const ip = dnsCache.get(host);
      const family = ip.includes(':') ? 6 : 4;
      if (options && options.all) {
        return callback(null, [{ address: ip, family }]);
      }
      return callback(null, ip, family);
    }

    return originalLookup(hostname, options, async (err, address, family) => {
      if (!err) {
        return callback(null, address, family);
      }

      if ((err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') && host) {
        // Re-check cache in case another request populated it concurrently
        if (dnsCache.has(host)) {
          const ip = dnsCache.get(host);
          const fam = ip.includes(':') ? 6 : 4;
          if (options && options.all) {
            return callback(null, [{ address: ip, family: fam }]);
          }
          return callback(null, ip, fam);
        }

        // Attempt DoH fallback
        try {
          const resolvedIp = await queryDoH(host);
          if (resolvedIp) {
            dnsCache.set(host, resolvedIp);
            logger.log?.(`[DNS] Resolved ${host} via DoH fallback to ${resolvedIp}`);
            const fam = resolvedIp.includes(':') ? 6 : 4;
            if (options && options.all) {
              return callback(null, [{ address: resolvedIp, family: fam }]);
            }
            return callback(null, resolvedIp, fam);
          }
        } catch (_) {
          // Ignore DoH error and fall through to return original error
        }
      }

      return callback(err, address, family);
    });
  };

  logger.log?.('[DNS] Resilient DNS resolver initialized with overrides:', Object.keys(overrides));
}

module.exports = {
  initDns,
  queryDoH,
  dnsCache
};
