const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config({ path: path.join(__dirname, '../.env') });
const { createRepositories } = require('../src/repositories');
const { createNoaBillingService, createNoaRepository } = require('../src/modules/noa');
const { createConfiguredVideoWorkerRuntime } = require('../src/modules/video-generation/worker/video-worker.bootstrap');
let dedicatedSignalHandlersInstalled = false;

async function runDedicatedWorker({
  env = process.env,
  installSignalHandlers = true,
  repositoriesFactory = createRepositories,
  runtimeFactory = createConfiguredVideoWorkerRuntime,
  noaBillingServiceFactory = (db) => createNoaBillingService({
    repository: createNoaRepository(db)
  })
} = {}) {
  const repositories = repositoriesFactory();
  await repositories.db.init();
  const noaBillingService = noaBillingServiceFactory(repositories.db);
  const runtime = runtimeFactory({
    db: repositories.db,
    httpClient: axios,
    noaBillingService,
    env,
    role: 'dedicated',
    logger: console
  });
  await runtime.start();
  let stopping = null;
  const shutdown = async () => {
    if (!stopping) stopping = (async () => { await runtime.stop(); await repositories.db.close(); })();
    return stopping;
  };
  if (installSignalHandlers && !dedicatedSignalHandlersInstalled) {
    dedicatedSignalHandlersInstalled = true;
    const handler = async () => { await shutdown(); process.exit(0); };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }
  return { runtime, shutdown };
}

if (require.main === module) runDedicatedWorker().catch((error) => { console.error('[VIDEO_WORKER] startup failed:', error.message); process.exitCode = 1; });
module.exports = { runDedicatedWorker };
