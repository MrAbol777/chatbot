'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { createAuthMiddleware } = require('../image-generation/auth.middleware');
const { createVideoGenerationRepository } = require('./video-generation.repository');
const { createVideoGenerationService } = require('./video-generation.service');
const { createVideoGenerationController } = require('./video-generation.controller');
const { createVideoContentController } = require('./video-content.controller');
const { createVideoContentAuthController } = require('./video-content-auth.controller');
const { createMetisVideoProvider } = require('./providers/metis-video.provider');
const { createBananaAiVideoProvider } = require('./providers/bananaai-video.provider');
const { createFakeVideoProvider } = require('./providers/fake-video.provider');
const { loadVideoStorageConfig } = require('./storage/video-storage.config');
const { createLocalVideoStorage } = require('./storage/local-video.storage');
const { createVideoInputMediaModule } = require('./input-media/video-input-media.module');
const { AiProviderRegistry } = require('../ai-routing/provider-registry');
const { createAiRoutingRepository } = require('../ai-routing/ai-routing.repository');
const { createAiCapabilityRouteResolver } = require('../ai-routing/capability-route-resolver');
const { createVideoPromptProfileRepository } = require('../video-prompt-profiles/video-prompt-profile.repository');
const { createVideoPromptProfilePublicRouter } = require('../video-prompt-profiles/video-prompt-profile.routes');
const { VideoPromptCompiler } = require('../video-prompt-profiles/video-prompt-compiler');

const splitList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function createVideoGenerationRouter(deps) {
  const router = express.Router();
  const env = deps.env || process.env;
  const storageConfig = loadVideoStorageConfig(env);
  const inputMedia = createVideoInputMediaModule({ db: deps.db, env });
  const useFake = env.NODE_ENV === 'test' && env.VIDEO_FAKE_PROVIDER === '1';
  const provider = useFake
    ? createFakeVideoProvider()
    : createMetisVideoProvider({
        httpClient: deps.httpClient,
        baseUrl: env.METIS_BASE_URL || env.METIS_VIDEO_BASE_URL,
        apiKey: env.METIS_API_KEY || env.METIS_VIDEO_API_KEY,
        requestTimeoutMs: Number(env.METIS_REQUEST_TIMEOUT_MS || 120000),
        statusTimeoutMs: Number(env.METIS_STATUS_TIMEOUT_MS || 30000),
        resultAllowedHosts: storageConfig.allowedHosts,
        resultAllowedPorts: storageConfig.allowedPorts,
        resultAllowedPathPrefixes: storageConfig.allowedPathPrefixes,
        resultTimeoutMs: storageConfig.timeoutMs,
        resultMaxBytes: storageConfig.maxBytes,
        resultMaxRedirects: storageConfig.maxRedirects
      });
  const repository = createVideoGenerationRepository(deps.db, {
    noaBillingService: deps.noaBillingService
  });
  const promptProfileRepository = createVideoPromptProfileRepository(deps.db);
  const registry = new AiProviderRegistry();
  registry.register(provider);
  if (!useFake) {
    registry.register(createBananaAiVideoProvider({
      httpClient: deps.httpClient,
      baseUrl: env.BANANAAI_BASE_URL || 'https://bananaai.ir',
      apiKey: env.BANANAAI_API_KEY,
      resultAllowedHosts: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS),
      resultAllowedPorts: storageConfig.allowedPorts,
      resultAllowedPathPrefixes: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES),
      resultTimeoutMs: storageConfig.timeoutMs,
      resultMaxBytes: storageConfig.maxBytes,
      resultMaxRedirects: storageConfig.maxRedirects
    }));
  }
  const routeResolver = String(env.AI_VIDEO_ROUTING_ENABLED || '1') === '1'
    ? createAiCapabilityRouteResolver({
        repository: createAiRoutingRepository(deps.db),
        registry,
        env
      })
    : null;
  const service = createVideoGenerationService({
    repository,
    noaBillingService: deps.noaBillingService,
    provider,
    routeResolver,
    promptProfileRepository,
    promptCompiler: new VideoPromptCompiler(),
    isFeatureEnabled: () => String(env.VIDEO_GENERATION_ENABLED || '0') === '1'
  });
  const controller = createVideoGenerationController(service);
  const storage = createLocalVideoStorage(storageConfig);
  const content = createVideoContentController({
    service,
    storage,
    jwtSecret: deps.authJwtSecret
  });
  const contentAuth = createVideoContentAuthController({
    service,
    jwtSecret: deps.authJwtSecret
  });
  const userAuth = createAuthMiddleware({
    jwtSecret: deps.authJwtSecret,
    db: deps.db
  });
  const loadOptionalAdmin = (req, _res, next) => {
    const token = req.cookies?.[deps.adminCookieName || 'admin_token'];
    if (token && deps.adminJwtSecret) {
      try {
        req.videoAdmin = jwt.verify(token, deps.adminJwtSecret);
      } catch (_) {
        req.videoAdmin = null;
      }
    }
    next();
  };
  const optionalBearerAuth = (req, res, next) => (
    String(req.headers.authorization || '').startsWith('Bearer ')
      ? userAuth(req, res, next)
      : next()
  );
  const submitLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.id || req.ip)
  });

  router.use(
    '/prompt-profiles',
    createVideoPromptProfilePublicRouter({ repository: promptProfileRepository })
  );
  router.get('/options', controller.options);

  // Native <video> requests authenticate with a short-lived, job-scoped,
  // HttpOnly cookie. A bearer token remains supported when explicitly sent.
  router.get('/:generationId/content', optionalBearerAuth, loadOptionalAdmin, content);
  router.head('/:generationId/content', optionalBearerAuth, loadOptionalAdmin, content);

  router.use(userAuth);
  router.use(loadOptionalAdmin);
  router.post(
    '/input-media',
    (req, res, next) => inputMedia.upload(req, res, (error) => (
      error
        ? res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
          .json({ error: error.code || 'VIDEO_INPUT_MEDIA_UPLOAD_FAILED' })
        : next()
    )),
    inputMedia.uploadHandler
  );
  router.post('/', submitLimiter, controller.submit);
  router.get('/', controller.list);
  router.get('/:generationId/content-auth', contentAuth);
  router.get('/:generationId', controller.get);

  return {
    router,
    publicInputRouter: inputMedia.publicRouter,
    providerInputGateway: inputMedia.gateway,
    service,
    storage,
    routeResolver,
    providerRegistry: registry,
    promptProfileRepository,
    inputMedia
  };
}

module.exports = { createVideoGenerationRouter };
