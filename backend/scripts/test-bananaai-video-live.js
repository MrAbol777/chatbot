'use strict';

// Intentionally not part of any automated test or readiness command. This
// script can make exactly one Grok Image-to-Video submit request and never
// polls the task. The image URL must already be public and explicitly supplied.
const axios = require('axios');
const { checkBananaAiLivePreconditions } = require('./bananaai-video-live-preconditions');

async function main({ env = process.env, httpClient = axios } = {}) {
  const readiness = checkBananaAiLivePreconditions(env);
  if (!readiness.ok) {
    console.error(`BLOCKED: explicit live-test preconditions are missing: ${readiness.missing.join(', ')}`);
    return { executed: false, externalRequests: 0 };
  }
  const response = await httpClient.post('https://bananaai.ir/api/v1/videos/image-to-video', {
    model: 'grok-imagine-video',
    prompt: String(env.BANANAAI_LIVE_PROMPT),
    image_urls: [String(env.BANANAAI_LIVE_IMAGE_URL)],
    duration: Number(env.BANANAAI_LIVE_DURATION),
    resolution: String(env.BANANAAI_LIVE_RESOLUTION),
    aspect_ratio: String(env.BANANAAI_LIVE_ASPECT_RATIO)
  }, { headers: { Authorization: `Bearer ${env.BANANAAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120_000, maxRedirects: 0 });
  const id = String(response?.data?.id || '');
  console.log(JSON.stringify({ submitted: Boolean(id), taskIdMasked: id ? `${id.slice(0, 4)}…${id.slice(-3)}` : null, externalRequests: 1 }));
  return { executed: true, externalRequests: 1 };
}

if (require.main === module) main().catch((error) => { console.error(`BananaAI live submit failed safely: HTTP ${Number(error?.response?.status || 0) || 'transport'}`); process.exitCode = 1; });
module.exports = { main };
