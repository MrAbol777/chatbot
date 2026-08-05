'use strict';

const NOA_ACTIONS = Object.freeze({
  TEXT_CHAT: 'text_chat',
  IMAGE_UNDERSTANDING: 'image_understanding',
  IMAGE_GENERATION: 'image_generation',
  VIDEO_GENERATION: 'video_generation'
});

const NOA_ACTION_KEYS = Object.freeze(Object.values(NOA_ACTIONS));

const NOA_SETTING_KEYS = Object.freeze({
  TOMAN_PER_NOA: 'toman_per_noa'
});

const NOA_CURRENCY = 'NOA';
const NOA_FIAT_CURRENCY = 'TOMAN';
const NOA_SCALE = 6;
const TOMAN_SCALE = 2;
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const FINANCIAL_ADMIN_ROLES = Object.freeze(new Set(['finance', 'superadmin']));

module.exports = {
  FINANCIAL_ADMIN_ROLES,
  NOA_ACTIONS,
  NOA_ACTION_KEYS,
  NOA_CURRENCY,
  NOA_FIAT_CURRENCY,
  NOA_SCALE,
  NOA_SETTING_KEYS,
  RECEIPT_MAX_BYTES,
  TOMAN_SCALE
};
