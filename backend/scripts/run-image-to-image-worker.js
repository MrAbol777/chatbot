'use strict';

const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config({ path: path.join(__dirname, '../.env') });
const { loadRuntimeConfig } = require('../src/bootstrap/config');
const { createRepositories } = require('../src/repositories');
const { createNoaBillingService, createNoaRepository } = require('../src/modules/noa');
const {
  createConfiguredImageToImageRuntime,
  resolveImageToImageWorkerMode
} = require('../src/modules/image-to-image/worker/image-to-image.bootstrap');

async function run() {
  const mode = resolveImageToImageWorkerMode(process.env);
  if (mode !== 'dedicated') {
    const error = new Error('Set IMAGE_TO_IMAGE_WORKER_MODE=dedicated before starting the dedicated image worker.');
    error.code = 'IMAGE_TO_IMAGE_DEDICATED_MODE_REQUIRED';
    throw error;
  }

  const repositories = createRepositories();
  await repositories.db.init();
  const runtime = createConfiguredImageToImageRuntime({
    db: repositories.db,
    httpClient: axios,
    noaBillingService: createNoaBillingService({ repository: createNoaRepository(repositories.db) }),
    config: loadRuntimeConfig(process.env).ai.imageToImage,
    role: 'dedicated',
    env: process.env
  });
  const state = await runtime.start();
  if (!state.started) {
    await repositories.db.close();
    throw new Error('Dedicated image-to-image worker did not start.');
  }

  const stop = async () => {
    await runtime.stop();
    await repositories.db.close();
  };
  process.once('SIGINT', async () => { await stop(); process.exit(0); });
  process.once('SIGTERM', async () => { await stop(); process.exit(0); });
}
if (require.main === module) run().catch((error) => { console.error('[IMAGE_TO_IMAGE_WORKER] startup failed:', error.message); process.exitCode = 1; });
module.exports = { run };
