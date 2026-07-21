#!/usr/bin/env node
'use strict';

/**
 * Minimal connectivity test for Metis Gemini wrapper.
 *
 * Usage:
 *   METIS_API_KEY=... node scripts/test-metis-gemini.js
 *   node scripts/test-metis-gemini.js --key=... --base=https://api.metisai.ir --model=gemini-2.5-pro
 */

const DEFAULT_BASE = 'https://api.metisai.ir';
const DEFAULT_MODEL = 'gemini-2.0-flash';

const args = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const found = args.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

const apiKey = getArg('key') || process.env.METIS_API_KEY || process.env.GEMINI_API_KEY || '';
const baseUrl = (getArg('base') || process.env.METIS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const model = getArg('model') || process.env.METIS_MODEL || DEFAULT_MODEL;
const prompt = getArg('prompt') || 'سلام! فقط بگو اتصال تست شد.';

if (!apiKey.trim()) {
  console.error('Missing API key. Pass --key=... or set METIS_API_KEY.');
  process.exit(1);
}

const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const body = {
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.2, maxOutputTokens: 80 }
};

const run = async (headerMode) => {
  const headers = { 'Content-Type': 'application/json' };
  if (headerMode === 'bearer') {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  } else {
    headers['x-goog-api-key'] = apiKey.trim();
  }

  const startedAt = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    parsed = null;
  }

  return {
    headerMode,
    ok: res.ok,
    status: res.status,
    durationMs: Date.now() - startedAt,
    data: parsed,
    raw: text
  };
};

const extractReply = (data) => {
  const candidates = data && Array.isArray(data.candidates) ? data.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (Array.isArray(parts) && typeof parts[0]?.text === 'string') {
    return parts[0].text;
  }
  return '';
};

(async () => {
  console.log('Testing endpoint:', endpoint);
  console.log('Model:', model);

  for (const mode of ['bearer', 'x-goog-api-key']) {
    try {
      const result = await run(mode);
      console.log(`\n[${mode}] status=${result.status} time=${result.durationMs}ms`);

      if (result.ok) {
        const reply = extractReply(result.data);
        console.log('Success.');
        console.log('Reply:', reply || '(no text in first candidate)');
        process.exit(0);
      }

      const errText =
        result.data && typeof result.data === 'object'
          ? JSON.stringify(result.data, null, 2)
          : result.raw.slice(0, 1200);
      console.log('Request failed:', errText);
    } catch (error) {
      const causeCode =
        error &&
        typeof error === 'object' &&
        error.cause &&
        typeof error.cause === 'object' &&
        typeof error.cause.code === 'string'
          ? error.cause.code
          : '';

      console.log(`[${mode}] network error: ${error instanceof Error ? error.message : String(error)}`);
      if (causeCode) {
        console.log(`[${mode}] cause code: ${causeCode}`);
      }
    }
  }

  console.log('\nAll attempts failed.');
  process.exit(2);
})().catch((error) => {
  console.error('Unexpected fatal error:', error);
  process.exit(3);
});

