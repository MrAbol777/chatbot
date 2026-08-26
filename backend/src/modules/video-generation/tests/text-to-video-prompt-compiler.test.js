'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileTextToVideoPrompt, STYLE_DIRECTIONS } = require('../text-to-video-prompt-compiler');
const { createVideoGenerationService } = require('../video-generation.service');
const { BANANAAI_TEXT_TO_VIDEO_MODEL_KEY } = require('../video-model.registry');
const { createNoaBillingFixture } = require('./noa-billing.fixture');

const profile = { id:'profile-cinematic',current_version_id:'profile-cinematic-v1',profile_key:'cinematic',version:1 };
const model = { internal_key:BANANAAI_TEXT_TO_VIDEO_MODEL_KEY,supports_text_to_video:1,supports_image_to_video:0,supports_negative_prompt:0,supports_audio:0,allowed_aspect_ratios:'["9:16","16:9","1:1"]',allowed_durations:JSON.stringify(Array.from({length:15},(_,index)=>String(index+1))),allowed_qualities:'[]',allowed_resolutions:'["480p"]',max_prompt_length:2000 };
const input = { mode:'text_to_video',styleKey:'cinematic',prompt:'یک روباه کوچک در جنگل مه‌آلود قدم می‌زند',duration:'5',resolution:'480p',aspectRatio:'9:16' };

test('T2V compiler keeps the user scene separate and applies a deterministic age-appropriate style', () => {
  const snapshot = compileTextToVideoPrompt({ profile, userPrompt:input.prompt, settings:input, maxCompiledPromptLength:2000 });
  assert.equal(snapshot.userPrompt, input.prompt);
  assert.match(snapshot.compiledPrompt, /original cinematic video/);
  assert.match(snapshot.compiledPrompt, /age-appropriate/);
  assert.match(snapshot.compiledPrompt, /Output: 5s, 480p, 9:16, no audio/);
  assert.match(snapshot.compiledPromptHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.compilerVersion, 't2v-1');
  assert.notEqual(STYLE_DIRECTIONS.cinematic, STYLE_DIRECTIONS.animation);
});

test('routed T2V persists the compiled style snapshot without any media input', async () => {
  let stored;
  const repository = {
    findIdempotent: async () => null,
    getModel: async () => model,
    createRoutedWithReservation: async ({ job }) => { stored = job; return { ...job, status:'queued' }; }
  };
  const service = createVideoGenerationService({
    repository,
    noaBillingService:createNoaBillingFixture(),
    provider:{},
    routeResolver:{ resolve:async () => ({ routeId:'video-t2v',routeVersion:2,providerKey:'bananaai',providerModelId:'grok-imagine-video',internalModelKey:BANANAAI_TEXT_TO_VIDEO_MODEL_KEY,routingPolicy:'PRIMARY_ONLY',candidates:[] }) },
    promptProfileRepository:{ getCurrentByKey:async () => profile },
    isFeatureEnabled:() => true
  });
  await service.submit({ userId:'user-1',idempotencyKey:'t2v-fixture-key',input });
  assert.equal(stored.mediaId, null);
  assert.equal(stored.userPrompt, input.prompt);
  assert.match(stored.compiledPrompt, /User scene:/);
  assert.equal(stored.promptProfileKey, 'cinematic');
  assert.equal(stored.modelKey, BANANAAI_TEXT_TO_VIDEO_MODEL_KEY);
});

test('routed T2V refuses a route that is not the dedicated Grok registration', async () => {
  let persisted = false;
  const service = createVideoGenerationService({
    repository:{ findIdempotent:async()=>null,getModel:async()=>model,createRoutedWithReservation:async()=>{ persisted=true; } },
    noaBillingService:createNoaBillingFixture(),
    provider:{},
    routeResolver:{ resolve:async () => ({ routeId:'video-t2v',routeVersion:1,providerKey:'bananaai',providerModelId:'grok-imagine-video',internalModelKey:'bananaai_grok_imagine_video',routingPolicy:'PRIMARY_ONLY',candidates:[] }) },
    promptProfileRepository:{ getCurrentByKey:async () => profile },
    isFeatureEnabled:() => true
  });
  await assert.rejects(service.submit({ userId:'user-1',idempotencyKey:'t2v-wrong-route',input }), { code:'VIDEO_GENERATION_MODEL_UNAVAILABLE' });
  assert.equal(persisted, false);
});

test('public options expose the T2V contract as the product capability', async () => {
  const service = createVideoGenerationService({
    repository:{},
    noaBillingService:createNoaBillingFixture(),
    provider:{},
    routeResolver:{
      publicRouteFor:async (capability) => {
        if (capability === 'video.image_to_video') throw Object.assign(new Error('disabled'), { code:'AI_ROUTE_DISABLED' });
        return { snapshot:{ providerKey:'bananaai' }, model };
      }
    },
    promptProfileRepository:{ listPublic:async () => [profile] },
    isFeatureEnabled:() => true
  });
  const options = await service.options();
  assert.equal(options.enabled, true);
  assert.deepEqual(options.capabilities['video.text_to_video'].allowedDurations, Array.from({length:15},(_,index)=>String(index+1)));
  assert.deepEqual(options.capabilities['video.text_to_video'].allowedResolutions, ['480p']);
  assert.equal(options.capabilities['video.text_to_video'].maxPromptLength, 1200);
  assert.equal(options.readiness['video.image_to_video'].available, false);
});
