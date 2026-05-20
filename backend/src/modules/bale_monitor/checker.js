const axios = require('axios');

async function checkUrl(url, timeoutMs) {
  const started = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true
    });
    return {
      ok: true,
      statusCode: res.status,
      latencyMs: Date.now() - started,
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      error: err?.message || 'Unknown error'
    };
  }
}

module.exports = { checkUrl };
