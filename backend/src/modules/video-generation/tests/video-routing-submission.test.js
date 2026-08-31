'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createVideoJobProcessingService } = require('../worker/video-job-processing.service');

const config = { leaseMs: 60_000, maxPollAttempts: 5, pollBaseDelayMs: 100, pollMaxDelayMs: 1_000 };
const job = (overrides = {}) => ({
  id: 'job-fixture', user_id: 'user-fixture', mode: 'text-to-video', capability_key: 'video.text_to_video', provider: 'fixture',
  provider_model_id_snapshot: 'fixture-model', provider_attempt_id: 'attempt-fixture', provider_job_id: null, status: 'queued', prompt: 'fixture prompt',
  duration: '5', resolution: '720p', aspect_ratio: '16:9', generate_audio: 0, negative_prompt: null, poll_attempts: 0,
  expires_at: new Date(Date.now() + 60_000), worker_lease_owner: 'worker-fixture', route_snapshot: JSON.stringify({ providerOperation: null, upstreamVendor: null }),
  ...overrides
});

function adapter(submit) {
  return { kind: 'fixture', getProviderKey: () => 'fixture', getCapabilities: () => ['video.text_to_video'], submit, validateRequest: () => {}, getJobStatus: async () => ({ status: 'pending' }), normalizeStatus: () => 'submitted', sanitizeError: () => 'خطای امن Provider' };
}

function imageAdapter(submit) {
  return { ...adapter(submit), getCapabilities: () => ['video.image_to_video'] };
}

function repository() {
  const events = [];
  return {
    events,
    beginSubmission: async () => { events.push('begin'); },
    extendJobLease: async () => { events.push('lease'); return true; },
    markSubmissionAccepted: async (value) => { events.push(['accepted', value.providerJobId]); },
    markSubmissionAmbiguous: async () => { events.push('ambiguous'); },
    rejectSubmissionAndRoute: async () => { events.push('rejected'); return { action: 'fallback-queued' }; }
  };
}

test('queued routed job submits once in the worker and persists acceptance', async () => {
  let submits = 0; const repo = repository();
  const service = createVideoJobProcessingService({ repository: repo, providerRegistry: { fixture: adapter(async () => { submits += 1; return { providerJobId: 'task-fixture' }; }) }, config });
  const result = await service.processClaimedJob(job(), { workerId: 'worker-fixture' });
  assert.equal(result.action, 'submitted'); assert.equal(submits, 1); assert.deepEqual(repo.events, ['begin', 'lease', ['accepted', 'task-fixture']]);
});

test('an ambiguous submit retries once with the same idempotency key before becoming unknown', async () => {
  let submits = 0; const repo = repository();
  const error = Object.assign(new Error('timeout fixture'), { code: 'VIDEO_PROVIDER_STATUS_UNKNOWN', submissionOutcome: 'ambiguous' });
  const service = createVideoJobProcessingService({ repository: repo, providerRegistry: { fixture: adapter(async () => { submits += 1; throw error; }) }, config });
  const result = await service.processClaimedJob(job({ danoa_request_id: 'request-fixture-1234' }), { workerId: 'worker-fixture' });
  assert.equal(result.action, 'provider-status-unknown'); assert.equal(submits, 2); assert.deepEqual(repo.events, ['begin', 'lease', 'ambiguous']);
});

test('an ambiguous submit is safely recovered by one idempotent retry', async () => {
  let submits = 0; let received; const repo = repository();
  const timeout = Object.assign(new Error('timeout fixture'), { code: 'VIDEO_PROVIDER_TIMEOUT', submissionOutcome: 'ambiguous' });
  const service = createVideoJobProcessingService({ repository: repo, providerRegistry: { fixture: adapter(async (input) => { received = input; submits += 1; if (submits === 1) throw timeout; return { providerJobId: 'task-recovered' }; }) }, config });
  const result = await service.processClaimedJob(job({ danoa_request_id: 'request-fixture-1234' }), { workerId: 'worker-fixture' });
  assert.equal(result.action, 'submitted');
  assert.equal(submits, 2);
  assert.equal(received.idempotencyKey, 'request-fixture-1234');
  assert.deepEqual(repo.events, ['begin', 'lease', ['accepted', 'task-recovered']]);
});

test('a long submission renews its lease until the provider replies', async () => {
  const repo = repository(); let resolveSubmit; const pending = new Promise((resolve) => { resolveSubmit = resolve; });
  const timers = { callbacks: [], setInterval(callback) { this.callbacks.push(callback); return callback; }, clearInterval() {} };
  const service = createVideoJobProcessingService({ repository: repo, providerRegistry: { fixture: adapter(async () => pending) }, config, timers });
  const resultPromise = service.processClaimedJob(job(), { workerId: 'worker-fixture' });
  await new Promise(setImmediate);
  await timers.callbacks[0]();
  resolveSubmit({ providerJobId: 'task-after-heartbeat' });
  const result = await resultPromise;
  assert.equal(result.action, 'submitted');
  assert.deepEqual(repo.events, ['begin', 'lease', 'lease', ['accepted', 'task-after-heartbeat']]);
});

test('confirmed rejection may queue snapshot fallback', async () => {
  const repo = repository(); const error = Object.assign(new Error('documented rejection'), { code: 'VIDEO_PROVIDER_CONFIRMED_REJECTION', submissionOutcome: 'confirmed_rejected' });
  const service = createVideoJobProcessingService({ repository: repo, providerRegistry: { fixture: adapter(async () => { throw error; }) }, config });
  const result = await service.processClaimedJob(job(), { workerId: 'worker-fixture' });
  assert.equal(result.action, 'fallback-queued'); assert.deepEqual(repo.events, ['begin', 'lease', 'rejected']);
});

test('a restarted submitting job becomes unknown without another provider call', async () => {
  let submits = 0; const repo = repository();
  const service = createVideoJobProcessingService({ repository: repo, providerRegistry: { fixture: adapter(async () => { submits += 1; return { providerJobId: 'never' }; }) }, config });
  const result = await service.processClaimedJob(job({ status: 'submitting' }), { workerId: 'worker-fixture' });
  assert.equal(result.action, 'provider-status-unknown'); assert.equal(submits, 0); assert.deepEqual(repo.events, ['ambiguous']);
});

test('I2V worker sends only the stored compiled prompt snapshot', async () => {
  let received; const repo=repository();
  const service=createVideoJobProcessingService({repository:repo,providerRegistry:{fixture:imageAdapter(async(input)=>{received=input;return {providerJobId:'task-i2v'};})},providerInputGateway:{createUrl:()=> 'https://media.example.test/api/video-provider-input/opaque'},config});
  const result=await service.processClaimedJob(job({mode:'image-to-video',capability_key:'video.image_to_video',prompt:'raw user request',compiled_prompt:'[[NON-NEGOTIABLE RULES]]\nidentity locked\n\n[[USER REQUEST]]\nraw user request',input_media_id:'media-1'}),{workerId:'worker-fixture'});
  assert.equal(result.action,'submitted');assert.match(received.prompt,/identity locked/);assert.notEqual(received.prompt,'raw user request');assert.equal(received.generateAudio,false);
});

test('I2V worker never recompiles or submits a job missing its compiled snapshot', async () => {
  let submits=0;const repo=repository();
  const service=createVideoJobProcessingService({repository:repo,providerRegistry:{fixture:imageAdapter(async()=>{submits+=1;return {providerJobId:'never'};})},providerInputGateway:{createUrl:()=> 'https://media.example.test/api/video-provider-input/opaque'},config});
  const result=await service.processClaimedJob(job({mode:'image-to-video',capability_key:'video.image_to_video',compiled_prompt:null,input_media_id:'media-1'}),{workerId:'worker-fixture'});
  assert.equal(submits,0);assert.equal(result.errorCode,'VIDEO_COMPILED_PROMPT_REQUIRED');assert.deepEqual(repo.events,['rejected']);
});

test('worker submits the immutable compiled prompt only when its stored hash matches', async () => {
  const compiledPrompt='A verified provider-ready cinematic prompt.';
  const compiledPromptHash=createHash('sha256').update(compiledPrompt).digest('hex');
  let received;const repo=repository();
  const service=createVideoJobProcessingService({repository:repo,providerRegistry:{fixture:adapter(async(input)=>{received=input;return {providerJobId:'task-hash-ok'};})},config});
  const result=await service.processClaimedJob(job({prompt:'raw request',compiled_prompt:compiledPrompt,compiled_prompt_hash:compiledPromptHash}),{workerId:'worker-fixture'});
  assert.equal(result.action,'submitted');assert.equal(received.prompt,compiledPrompt);
});

test('worker fails closed before provider submission when the compiled prompt hash is corrupted', async () => {
  let submits=0;const repo=repository();
  const service=createVideoJobProcessingService({repository:repo,providerRegistry:{fixture:adapter(async()=>{submits+=1;return {providerJobId:'never'};})},config});
  const result=await service.processClaimedJob(job({compiled_prompt:'A tampered provider prompt.',compiled_prompt_hash:'0'.repeat(64)}),{workerId:'worker-fixture'});
  assert.equal(submits,0);assert.equal(result.errorCode,'VIDEO_COMPILED_PROMPT_HASH_MISMATCH');assert.deepEqual(repo.events,['rejected']);
});
