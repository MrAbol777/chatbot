'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertActivationConfig } = require('../../../../scripts/activate-bananaai-text-to-video');

const validEnv = {
  VIDEO_GENERATION_ACTIVATION_EXPECTED:'1',
  VIDEO_GENERATION_ENABLED:'1',
  BANANAAI_API_KEY:'fixture',
  BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS:'cdn.example.test',
  BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES:'/video-results/'
};

test('T2V activation requires provider result safety but never an image-input gateway', () => {
  assert.doesNotThrow(() => assertActivationConfig(validEnv));
  assert.throws(() => assertActivationConfig({ ...validEnv, BANANAAI_API_KEY:'' }), /BANANAAI_API_KEY/);
  assert.throws(() => assertActivationConfig({ ...validEnv, BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES:'' }), /result URL contract/);
});

test('the additive T2V migration does not update the Image-to-Video route', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../../migrations/047_grok_text_to_video.sql'), 'utf8');
  assert.match(sql, /bananaai_grok_imagine_video_t2v/);
  assert.match(sql, /video\.text_to_video/);
  assert.match(sql, /cost_config,provider_config,quota_units,sort_order,created_at,updated_at/);
  assert.match(sql, /LIVE_VALIDATION_REQUIRED'\),1,1099,NOW\(\),NOW\(\)\)/);
  assert.equal(sql.includes("capability_key='video.image_to_video'"), false);
});
