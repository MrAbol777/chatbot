'use strict';

const GROK_MODEL = 'grok-imagine-video';
const CONFIRM_PROVIDER = 'I_CONFIRM_BANANAAI_GROK_LIVE_REQUEST';
const CONFIRM_COST = 'I_CONFIRM_BANANAAI_GROK_COST';

function checkBananaAiLivePreconditions(env = {}) {
  const missing = [];
  if (env.BANANAAI_LIVE_CONFIRM_PROVIDER !== CONFIRM_PROVIDER) missing.push('BANANAAI_LIVE_CONFIRM_PROVIDER');
  if (env.BANANAAI_LIVE_CONFIRM_COST !== CONFIRM_COST) missing.push('BANANAAI_LIVE_CONFIRM_COST');
  if (!String(env.BANANAAI_API_KEY || '').trim()) missing.push('BANANAAI_API_KEY');
  if (env.BANANAAI_LIVE_MODEL !== GROK_MODEL) missing.push('BANANAAI_LIVE_MODEL=grok-imagine-video');
  for (const key of ['BANANAAI_LIVE_PROMPT','BANANAAI_LIVE_DURATION','BANANAAI_LIVE_RESOLUTION','BANANAAI_LIVE_ASPECT_RATIO']) if (!String(env[key] || '').trim()) missing.push(key);
  try {
    const imageUrl = new URL(String(env.BANANAAI_LIVE_IMAGE_URL || ''));
    if (imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password) throw new Error('unsafe');
  } catch (_) { missing.push('BANANAAI_LIVE_IMAGE_URL=https://...'); }
  return Object.freeze({ ok: missing.length === 0, missing, model: GROK_MODEL, maximumExternalRequests: 1 });
}

module.exports = { GROK_MODEL, CONFIRM_PROVIDER, CONFIRM_COST, checkBananaAiLivePreconditions };
