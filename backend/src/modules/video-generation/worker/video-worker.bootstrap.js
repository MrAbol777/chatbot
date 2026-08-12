const { createVideoWorkerRepository } = require('./video-worker.repository');
const { createVideoJobProcessingService } = require('./video-job-processing.service');
const { createVideoGenerationWorker } = require('./video-generation.worker');
const { createVideoWorkerRuntime } = require('./video-worker.runtime');
const { loadVideoWorkerConfig } = require('./video-worker.config');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');
const { createMetisVideoProvider } = require('../providers/metis-video.provider');
const { createBananaAiVideoProvider } = require('../providers/bananaai-video.provider');
const { loadVideoStorageConfig } = require('../storage/video-storage.config');
const { createLocalVideoStorage } = require('../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../storage/video-result-orchestrator');
const { createVideoProviderInputGateway } = require('../input-media/video-provider-input.gateway');
const { createVideoInputMediaRepository } = require('../input-media/video-input-media.repository');
const { createVideoInputMediaStorage } = require('../input-media/video-input-media.storage');
const { createMetisVideoProviderInputPublisher } = require('../input-media/metis-video-provider-input.publisher');
const path = require('path');
const { createAiRoutingRepository } = require('../../ai-routing/ai-routing.repository');
const { createAiSnapshotSubmissionGuard } = require('../../ai-routing/snapshot-submission-guard');
const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

function createVideoWorkerProviderRegistry({ httpClient, env = process.env, storageConfig = null }) {
  if (env.NODE_ENV === 'test') return { fake: createFakeVideoProvider(), test: createFakeVideoProvider() };
  return {
    metis: createMetisVideoProvider({ httpClient, baseUrl: env.METIS_BASE_URL || env.METIS_VIDEO_BASE_URL, apiKey: env.METIS_API_KEY || env.METIS_VIDEO_API_KEY, requestTimeoutMs: Number(env.METIS_REQUEST_TIMEOUT_MS || 120000), statusTimeoutMs: Number(env.METIS_STATUS_TIMEOUT_MS || 30000), resultAllowedHosts: storageConfig?.allowedHosts || [], resultAllowedPorts: storageConfig?.allowedPorts || [443], resultAllowedPathPrefixes: storageConfig?.allowedPathPrefixes || ['/'], resultTimeoutMs: storageConfig?.timeoutMs, resultMaxBytes: storageConfig?.maxBytes, resultMaxRedirects: storageConfig?.maxRedirects }),
    bananaai: createBananaAiVideoProvider({ httpClient, baseUrl: env.BANANAAI_BASE_URL || 'https://bananaai.ir', apiKey: env.BANANAAI_API_KEY, proxyUrl: env.BANANAAI_PROXY_URL, forceIpv4: String(env.BANANAAI_FORCE_IPV4 ?? 'true').toLowerCase() !== 'false', requestTimeoutMs: Number(env.BANANAAI_REQUEST_TIMEOUT_MS || 120000), statusTimeoutMs: Number(env.BANANAAI_STATUS_TIMEOUT_MS || 30000), resultAllowedHosts: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS), resultAllowedPorts: storageConfig?.allowedPorts || [443], resultAllowedPathPrefixes: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES), resultTimeoutMs: storageConfig?.timeoutMs, resultMaxBytes: storageConfig?.maxBytes, resultMaxRedirects: storageConfig?.maxRedirects })
  };
}

function createConfiguredVideoWorkerRuntime({ db, httpClient, noaBillingService, env = process.env, role = 'embedded', logger = console, timers, clock }) {
  const config = loadVideoWorkerConfig(env);
  const storageConfig = loadVideoStorageConfig(env);
  const providerRegistry = createVideoWorkerProviderRegistry({ httpClient, env, storageConfig });
  const repository = createVideoWorkerRepository(db, { noaBillingService });
  const storage = createLocalVideoStorage(storageConfig);
  const storageOrchestrator = createVideoResultOrchestrator({ storage, config: storageConfig, logger, clock });
  const providerInputMode = String(env.VIDEO_PROVIDER_INPUT_MODE || 'gateway').trim().toLowerCase();
  if (!['gateway', 'remote_upload'].includes(providerInputMode)) throw new Error('VIDEO_PROVIDER_INPUT_MODE_INVALID');
  const providerInputGateway = providerInputMode === 'remote_upload'
    ? createMetisVideoProviderInputPublisher({
      httpClient,
      repository: createVideoInputMediaRepository(db),
      storage: createVideoInputMediaStorage({ root: env.VIDEO_INPUT_STORAGE_ROOT || path.join(__dirname, '../../../../storage/video-inputs') }),
      baseUrl: env.VIDEO_PROVIDER_INPUT_UPLOAD_BASE_URL || env.IMAGE_BASE_URL || 'https://api.metisai.ir',
      apiKey: env.VIDEO_PROVIDER_INPUT_UPLOAD_API_KEY || env.METIS_IMAGE_API_KEY || env.METIS_API_KEY,
      allowedHosts: splitList(env.VIDEO_PROVIDER_INPUT_UPLOAD_ALLOWED_HOSTS),
      allowedPathPrefixes: splitList(env.VIDEO_PROVIDER_INPUT_UPLOAD_ALLOWED_PATH_PREFIXES),
      maxBytes: Number(env.VIDEO_INPUT_MAX_BYTES || 5 * 1024 * 1024),
      timeoutMs: Number(env.VIDEO_PROVIDER_INPUT_UPLOAD_TIMEOUT_MS || 120000)
    })
    : createVideoProviderInputGateway({ secret: env.VIDEO_PROVIDER_INPUT_SIGNING_SECRET, publicBaseUrl: env.VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL, ttlSeconds: Number(env.VIDEO_PROVIDER_INPUT_TTL_SECONDS || 300), clock: clock ? () => clock().getTime() : undefined });
  const submissionGuard = createAiSnapshotSubmissionGuard({ repository: createAiRoutingRepository(db), providerRegistry, env });
  const processingService = createVideoJobProcessingService({ repository, providerRegistry, config, storageOrchestrator, providerInputGateway, submissionGuard, logger, clock });
  return createVideoWorkerRuntime({ config, role, timers, clock, logger, workerDependencies: { repository, processingService, config, logger }, createWorker: createVideoGenerationWorker });
}

module.exports = { createVideoWorkerProviderRegistry, createConfiguredVideoWorkerRuntime };
