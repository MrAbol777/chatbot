'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnimationVideoPipeline } = require('./animation-video-pipeline');

test('creates one normal image-to-video job per approved storyboard scene in order', async () => {
  const calls = [];
  const payload = { aspectRatio: '16:9', audioSettings: [], approvedSnapshot: { characterSheet: { analysis: { characters: [] } }, storyboard: { scenes: [{ id: 'scene-1', sourceSceneId: 'SC-1', durationSeconds: 5, imageJobId: 'image-1', imagePrompt: 'A calm animated scene.' }] } } };
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM animation_video_jobs WHERE status')) return [[{ animation_job_id: 'job-1', user_id: 'user-1', payload }]];
    if (sql.includes('FROM animation_video_scenes WHERE animation_job_id')) return [[{ animation_scene_job_id: 'scene-job-1', animation_job_id: 'job-1', source_scene_id: 'SC-1', scene_order: 1, status: 'queued', duration_seconds: 5, storyboard_image_job_id: 'image-1', retry_count: 0 }]];
    if (sql.includes('FROM app_image_to_image_jobs')) return [[{ result_storage_key: 'image-1/result.png', result_mime_type: 'image/png' }]];
    return [{ affectedRows: 1 }];
  } };
  let submitted;
  const pipeline = createAnimationVideoPipeline({ db, videoService: { submit: async (value) => { submitted = value; return { id: 'video-1' }; }, getContentRecord: async () => ({ status: 'processing' }) }, inputMedia: { storage: { store: async () => ({ storageKey: 'input.png', sha256: 'x', sizeBytes: 10 }) }, repository: { create: async () => {} } }, imageStorage: { read: async () => Buffer.from('image') }, montage: { compose: async () => ({ storageKey: 'final.mp4' }) } });
  await pipeline.tick();
  assert.equal(submitted.input.mode, 'image-to-video');
  assert.equal(submitted.input.duration, '5');
  assert.equal(submitted.input.aspectRatio, '16:9');
  assert.match(submitted.input.prompt, /scene 1 of 1/i);
  assert.match(submitted.input.prompt, /exact opening visual reference/i);
  assert.match(submitted.idempotencyKey, /animation:job-1:SC-1:r0/);
});

test('does not create a provider job when an approved storyboard frame is unavailable', async () => {
  const payload = { aspectRatio: '16:9', audioSettings: [], approvedSnapshot: { characterSheet: { analysis: { characters: [] } }, storyboard: { scenes: [{ id: 'scene-1', sourceSceneId: 'SC-1', durationSeconds: 5, imageJobId: 'missing' }] } } };
  const db = { query: async (sql) => {
    if (sql.includes('FROM animation_video_jobs WHERE status')) return [[{ animation_job_id: 'job-1', user_id: 'user-1', payload }]];
    if (sql.includes('FROM animation_video_scenes WHERE animation_job_id')) return [[{ animation_scene_job_id: 'scene-job-1', source_scene_id: 'SC-1', scene_order: 1, status: 'queued', duration_seconds: 5, storyboard_image_job_id: 'missing', retry_count: 0 }]];
    if (sql.includes('FROM app_image_to_image_jobs')) return [[]];
    return [{ affectedRows: 1 }];
  } };
  let submitted = false;
  const pipeline = createAnimationVideoPipeline({ db, videoService: { submit: async () => { submitted = true; }, getContentRecord: async () => null }, inputMedia: { storage: {}, repository: {} }, imageStorage: {}, montage: {} });
  await pipeline.tick();
  assert.equal(submitted, false);
});
