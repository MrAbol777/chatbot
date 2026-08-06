'use strict';

const ROUTING_POLICIES = Object.freeze({
  PRIMARY_ONLY: 'PRIMARY_ONLY',
  AUTO_FALLBACK: 'AUTO_FALLBACK',
  FALLBACK_ONLY: 'FALLBACK_ONLY'
});

const VIDEO_CAPABILITIES = Object.freeze({
  TEXT_TO_VIDEO: 'video.text_to_video',
  IMAGE_TO_VIDEO: 'video.image_to_video',
  IMAGE_TO_VIDEO_MULTI: 'video.image_to_video_multi'
});

function assertCapabilityKey(value) {
  const key = String(value || '').trim();
  if (!/^(chat|image|audio|video)\.[a-z][a-z0-9_]{1,63}$/.test(key)) throw new Error('AI_CAPABILITY_INVALID');
  return key;
}

function assertRoutingPolicy(value) {
  const policy = String(value || '').trim();
  if (!Object.values(ROUTING_POLICIES).includes(policy)) throw new Error('AI_ROUTING_POLICY_INVALID');
  return policy;
}

function candidateOrder(route) {
  const primary = route?.primary ? [route.primary] : [];
  const fallback = route?.fallback ? [route.fallback] : [];
  switch (assertRoutingPolicy(route?.policy)) {
    case ROUTING_POLICIES.PRIMARY_ONLY: return primary;
    case ROUTING_POLICIES.FALLBACK_ONLY: return fallback;
    case ROUTING_POLICIES.AUTO_FALLBACK: return [...primary, ...fallback];
    default: return [];
  }
}

module.exports = { ROUTING_POLICIES, VIDEO_CAPABILITIES, assertCapabilityKey, assertRoutingPolicy, candidateOrder };

