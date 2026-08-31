'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createTextToVideoPromptCompiler } = require('../text-to-video-prompt-compiler');
const { createVideoGenerationService } = require('../video-generation.service');
const { BANANAAI_TEXT_TO_VIDEO_MODEL_KEY, BANANAAI_GROK_T2V_MAX_PROMPT_LENGTH } = require('../video-model.registry');
const { createNoaBillingFixture } = require('./noa-billing.fixture');

const profile = { id:'profile-cinematic',current_version_id:'profile-cinematic-v1',profile_key:'cinematic',version:1 };
const model = { internal_key:BANANAAI_TEXT_TO_VIDEO_MODEL_KEY,supports_text_to_video:1,supports_image_to_video:0,supports_negative_prompt:0,supports_audio:0,allowed_aspect_ratios:'["9:16","16:9","1:1"]',allowed_durations:JSON.stringify(Array.from({length:15},(_,index)=>String(index+1))),allowed_qualities:'[]',allowed_resolutions:'["480p"]',max_prompt_length:BANANAAI_GROK_T2V_MAX_PROMPT_LENGTH };
const input = { mode:'text_to_video',styleKey:'cinematic',prompt:'  یک روباه کوچک در جنگل مه‌آلود قدم می‌زند  ',duration:'5',resolution:'480p',aspectRatio:'9:16' };
const SYSTEM = 'POLICY\n[[CORE]]\nCore identity and exact-user rules.\n[[/CORE]]\n[[CONTINUITY]]\nContinuity and camera rules.\n[[/CONTINUITY]]\n[[QUALITY]]\nQuality-control rules.\n[[/QUALITY]]\n';

async function withCompiler(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 't2v-direct-'));
  const filename = path.join(directory, 'system.txt');
  await fs.writeFile(filename, SYSTEM, 'utf8');
  try { return await run(createTextToVideoPromptCompiler({ systemPromptPath:filename })); }
  finally { await fs.rm(directory, { recursive:true, force:true }); }
}

function serviceFixture({ compiler, rowModel = model } = {}) {
  let stored;
  const service = createVideoGenerationService({
    repository:{findIdempotent:async()=>null,getModel:async()=>rowModel,createRoutedWithReservation:async({job})=>{stored=job;return {...job,status:'queued'};}},
    noaBillingService:createNoaBillingFixture(),
    provider:{},
    routeResolver:{resolve:async()=>({routeId:'video-t2v',routeVersion:3,providerKey:'bananaai',providerModelId:'grok-imagine-video',internalModelKey:BANANAAI_TEXT_TO_VIDEO_MODEL_KEY,routingPolicy:'PRIMARY_ONLY',candidates:[]})},
    promptProfileRepository:{getCurrentByKey:async()=>profile},
    textToVideoPromptCompiler:compiler,
    isFeatureEnabled:()=>true
  });
  return { service, getStored:()=>stored };
}

test('direct compiler sends all system tiers with the exact user request and settings', async () => {
  await withCompiler(async (compiler) => {
    const result = compiler.compile({ profile,userPrompt:input.prompt,settings:{...input,generateAudio:false},maxCompiledPromptLength:8000 });
    assert.equal(result.userPrompt, input.prompt);
    assert.equal(result.assemblyMode, 'full');
    assert.deepEqual(result.includedTiers, ['CORE','CONTINUITY','QUALITY']);
    assert.match(result.compiledPrompt, /Core identity/);
    assert.match(result.compiledPrompt, /Continuity and camera/);
    assert.match(result.compiledPrompt, /Quality-control/);
    assert.ok(result.compiledPrompt.includes(input.prompt));
    assert.match(result.compiledPrompt, /duration=5s/);
    assert.match(result.compiledPromptHash, /^[a-f0-9]{64}$/);
    assert.equal(result.systemPromptHash, createHash('sha256').update(SYSTEM).digest('hex'));
    assert.equal(result.compilerVersion, 't2v-direct-v2');
  });
});

test('budget reduction removes only lower-priority system tiers and never changes user text', async () => {
  await withCompiler(async (compiler) => {
    const exactUser = `  ${'کاراکتر'.repeat(70)}  `;
    const full = compiler.compile({profile,userPrompt:exactUser,settings:input,maxCompiledPromptLength:8000});
    const balancedLimit = full.finalChars - 10;
    const reduced = compiler.compile({profile,userPrompt:exactUser,settings:input,maxCompiledPromptLength:balancedLimit});
    assert.notEqual(reduced.assemblyMode, 'full');
    assert.equal(reduced.userPrompt, exactUser);
    assert.ok(reduced.compiledPrompt.includes(exactUser));
    assert.equal(reduced.compiledPrompt.includes('Quality-control rules.'), false);
  });
});

test('compiler fails clearly instead of truncating a user request that cannot fit with core rules', async () => {
  await withCompiler(async (compiler) => {
    const exactUser = `START-${'ز'.repeat(1500)}-END`;
    assert.throws(
      () => compiler.compile({profile,userPrompt:exactUser,settings:input,maxCompiledPromptLength:256}),
      (error) => error.code === 'T2V_COMPILED_PROMPT_TOO_LONG' && error.details.userChars === exactUser.length
    );
  });
});

test('routed T2V persists direct-runtime prompt and safe assembly metadata without a network planner', async () => {
  await withCompiler(async (compiler) => {
    const fixture=serviceFixture({compiler});
    await fixture.service.submit({userId:'user-1',idempotencyKey:'t2v-direct-fixture',input});
    const stored=fixture.getStored();
    assert.equal(stored.userPrompt,input.prompt);
    assert.ok(stored.compiledPrompt.includes(input.prompt));
    assert.equal(stored.promptCompilerVersion,'t2v-direct-v2');
    assert.equal(stored.routeSnapshot.promptAssembly.mode,'direct-runtime');
    assert.equal(stored.routeSnapshot.promptAssembly.assemblyMode,'full');
    assert.equal(stored.routeSnapshot.promptAssembly.userChars,input.prompt.length);
    assert.equal(JSON.stringify(stored.routeSnapshot.promptAssembly).includes(input.prompt),false);
  });
});

test('public options keep 4000 exact user characters while exposing the 8000 final budget', async () => {
  const service=createVideoGenerationService({
    repository:{},noaBillingService:createNoaBillingFixture(),provider:{},
    routeResolver:{publicRouteFor:async(capability)=>{if(capability==='video.image_to_video')throw Object.assign(new Error('disabled'),{code:'AI_ROUTE_DISABLED'});return {snapshot:{providerKey:'bananaai'},model};}},
    promptProfileRepository:{listPublic:async()=>[profile]},isFeatureEnabled:()=>true
  });
  const options=await service.options();
  assert.equal(options.capabilities['video.text_to_video'].maxPromptLength,4000);
  assert.equal(options.capabilities['video.text_to_video'].providerPromptMaxLength,8000);
});

test('routed T2V maps an impossible combined budget to a clear pre-persistence error', async () => {
  await withCompiler(async (compiler) => {
    let persisted=false;
    const tinyModel={...model,max_prompt_length:256};
    const fixture=serviceFixture({compiler,rowModel:tinyModel});
    fixture.service.submit;
    const original=fixture.getStored;
    await assert.rejects(fixture.service.submit({userId:'user-1',idempotencyKey:'t2v-too-long',input}),{code:'VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG'});
    persisted=Boolean(original());
    assert.equal(persisted,false);
  });
});

test('routed T2V refuses a route that is not the dedicated Grok registration', async () => {
  let persisted=false;
  const service=createVideoGenerationService({
    repository:{findIdempotent:async()=>null,getModel:async()=>model,createRoutedWithReservation:async()=>{persisted=true;}},
    noaBillingService:createNoaBillingFixture(),provider:{},
    routeResolver:{resolve:async()=>({routeId:'video-t2v',routeVersion:1,providerKey:'bananaai',providerModelId:'grok-imagine-video',internalModelKey:'bananaai_grok_imagine_video',routingPolicy:'PRIMARY_ONLY',candidates:[]})},
    promptProfileRepository:{getCurrentByKey:async()=>profile},isFeatureEnabled:()=>true
  });
  await assert.rejects(service.submit({userId:'user-1',idempotencyKey:'t2v-wrong-route',input}),{code:'VIDEO_GENERATION_MODEL_UNAVAILABLE'});
  assert.equal(persisted,false);
});
