const { createVideoWorkerRepository } = require('./video-worker.repository');
const { createVideoJobProcessingService } = require('./video-job-processing.service');
const { createVideoGenerationWorker } = require('./video-generation.worker');
const { createVideoWorkerRuntime } = require('./video-worker.runtime');
const { loadVideoWorkerConfig } = require('./video-worker.config');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');
const { createMetisVideoProvider } = require('../providers/metis-video.provider');
const { loadVideoStorageConfig } = require('../storage/video-storage.config');
const { createLocalVideoStorage } = require('../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../storage/video-result-orchestrator');

function createVideoWorkerProviderRegistry({ httpClient, env = process.env, storageConfig = null }) {
  if (env.NODE_ENV === 'test') return { fake: createFakeVideoProvider(), test: createFakeVideoProvider() };
  return { metis: createMetisVideoProvider({ httpClient, baseUrl: env.METIS_BASE_URL || env.METIS_VIDEO_BASE_URL, apiKey: env.METIS_API_KEY || env.METIS_VIDEO_API_KEY, requestTimeoutMs: Number(env.METIS_REQUEST_TIMEOUT_MS || 120000), statusTimeoutMs: Number(env.METIS_STATUS_TIMEOUT_MS || 30000), resultAllowedHosts: storageConfig?.allowedHosts || [], resultAllowedPorts: storageConfig?.allowedPorts || [443], resultAllowedPathPrefixes: storageConfig?.allowedPathPrefixes || ['/'], resultTimeoutMs: storageConfig?.timeoutMs, resultMaxBytes: storageConfig?.maxBytes, resultMaxRedirects: storageConfig?.maxRedirects }) };
}

function createConfiguredVideoWorkerRuntime({ db, httpClient, env = process.env, role = 'embedded', logger = console, timers, clock }) {
  const config = loadVideoWorkerConfig(env);
  const storageConfig = loadVideoStorageConfig(env);
  const providerRegistry = createVideoWorkerProviderRegistry({ httpClient, env, storageConfig });
  const repository = createVideoWorkerRepository(db);
  const storage = createLocalVideoStorage(storageConfig);
  const storageOrchestrator = createVideoResultOrchestrator({ storage, config: storageConfig, logger, clock });
  const processingService = createVideoJobProcessingService({ repository, providerRegistry, config, storageOrchestrator, logger, clock });
  return createVideoWorkerRuntime({ config, role, timers, clock, logger, workerDependencies: { repository, processingService, config, logger }, createWorker: createVideoGenerationWorker });
}

module.exports = { createVideoWorkerProviderRegistry, createConfiguredVideoWorkerRuntime };
