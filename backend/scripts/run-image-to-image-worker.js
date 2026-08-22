'use strict';

const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config({ path: path.join(__dirname, '../.env') });
const { loadRuntimeConfig } = require('../src/bootstrap/config');
const { createRepositories } = require('../src/repositories');
const { createNoaBillingService, createNoaRepository } = require('../src/modules/noa');
const { createConfiguredImageToImageRuntime } = require('../src/modules/image-to-image/worker/image-to-image.bootstrap');

async function run() {
  const repositories = createRepositories(); await repositories.db.init();
  const runtime = createConfiguredImageToImageRuntime({ db: repositories.db, httpClient: axios, noaBillingService: createNoaBillingService({ repository: createNoaRepository(repositories.db) }), config: loadRuntimeConfig(process.env).ai.imageToImage, role: 'dedicated' });
  await runtime.start();
  const stop = async () => { await runtime.stop(); await repositories.db.close(); };
  process.once('SIGINT', async () => { await stop(); process.exit(0); }); process.once('SIGTERM', async () => { await stop(); process.exit(0); });
}
if (require.main === module) run().catch((error) => { console.error('[IMAGE_TO_IMAGE_WORKER] startup failed:', error.message); process.exitCode = 1; });
module.exports = { run };
