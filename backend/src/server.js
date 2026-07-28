const express = require('express');
const cors = require('cors');
const compression = require('compression');
const axios = require('axios');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { loadRuntimeConfig } = require('./bootstrap/config');
const { now, log, attachProcessErrorLogging } = require('./bootstrap/logging');
dotenv.config({
  path: path.join(__dirname, '../.env')
});
const { createAdminRouter } = require('./adminRoutes');
const { initBaleMonitor } = require('./modules/bale_monitor');
const { createHealthRouter } = require('./modules/health/health.routes');
const { createSmsRouter } = require('./modules/sms/sms.routes');
const { createSmsService } = require('./modules/sms/sms.service');
const { createAiRouter } = require('./modules/ai/ai.routes');
const { createImageGenerationRouter } = require('./modules/image-generation/image-generation.routes');
const { createAuthMiddleware } = require('./modules/image-generation/auth.middleware');
const { createImageUnderstandingRouter } = require('./modules/image-understanding/image-understanding.routes');
const { createIntentRouterService } = require('./modules/intent-router/intent-router.service');
const { createInputOptimizerService } = require('./modules/input-optimizer/input-optimizer.service');
const { createConversationTitleService } = require('./modules/conversation-title/conversation-title.service');
const { createConversationMemoryService } = require('./modules/conversation-memory/conversation-memory.service');
const { createConversationMemoryWriterService } = require('./modules/conversation-memory/conversation-memory-writer.service');
const { createConversationContextBuilder } = require('./modules/conversation-memory/conversation-context-builder.service');
const { createPromptService } = require('./modules/ai/prompt.service');
const { createAuthModule } = require('./modules/auth/auth.module');
const { createLocalDevelopmentRouter } = require('./modules/auth/local-development.routes');
const { createConversationsModule } = require('./modules/conversations');
const { createRepositories } = require('./repositories');
const { createConfiguredVideoWorkerRuntime } = require('./modules/video-generation/worker/video-worker.bootstrap');
const {
  createNoaAdminRouter,
  createNoaBillingService,
  createNoaReceiptService,
  createNoaReceiptStorage,
  createNoaRepository,
  createNoaUserRouter,
  reconcileExpiredNoaOperations
} = require('./modules/noa');

const app = express();
const repositories = createRepositories();
let videoWorkerRuntime = null;
let serverSignalHandlersInstalled = false;
const uploadsDir = path.resolve(__dirname, '../uploads');
const generatedImagesDir = path.join(uploadsDir, 'images-generated');
const defaultAllowedImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
const allowedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const imageMimeTypeByExtension = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
// Accepts UUIDs or numeric DB primary keys (e.g. "17")
const imageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^[1-9]\d*$|^0$/i;

fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(generatedImagesDir);

const getAllowedExtension = (filename = '') => {
  const ext = path.extname(filename || '').toLowerCase();
  return allowedImageExtensions.has(ext) ? ext : null;
};

const getAppSettings = async () => {
  try {
    return await repositories.settings.getAll();
  } catch (error) {
    console.error('[settings] failed to read settings, using defaults', error instanceof Error ? error.message : String(error));
    return {};
  }
};

const getUploadSettings = async () => {
  const settings = await getAppSettings();
  const maxSizeMb = Number.isFinite(Number(settings['upload.image.max_size_mb']))
    ? Number(settings['upload.image.max_size_mb'])
    : 5;
  const maxFiles = Number.isFinite(Number(settings['upload.image.max_files']))
    ? Number(settings['upload.image.max_files'])
    : 5;
  const allowedTypes = Array.isArray(settings['upload.image.allowed_types']) && settings['upload.image.allowed_types'].length > 0
    ? settings['upload.image.allowed_types']
    : defaultAllowedImageMimeTypes;

  return {
    maxSizeMb,
    maxFiles,
    maxSizeBytes: maxSizeMb * 1024 * 1024,
    allowedTypes
  };
};

const getUploadedImageById = async (imageId) => {
  if (typeof imageId !== 'string' || !imageIdPattern.test(imageId)) {
    return null;
  }
  const uploadSettings = await getUploadSettings();

  for (const ext of allowedImageExtensions) {
    const candidate = path.join(uploadsDir, `${imageId}${ext}`);
    if (await fs.pathExists(candidate)) {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > uploadSettings.maxSizeBytes) {
        return null;
      }
      const buffer = await fs.readFile(candidate);
      return {
        imageId,
        mimeType: imageMimeTypeByExtension[ext],
        base64: buffer.toString('base64')
      };
    }
  }

  return null;
};

const uploadedImagesRepository = {
  getByIds: async (imageIds) => {
    const images = [];
    for (const imageId of Array.isArray(imageIds) ? imageIds : []) {
      const image = await getUploadedImageById(imageId);
      if (image) {
        images.push(image);
      }
    }
    return images;
  }
};

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = getAllowedExtension(file.originalname);
    if (!ext) {
      cb(new Error('INVALID_FILE_TYPE'));
      return;
    }
    const imageId = uuidv4();
    cb(null, `${imageId}${ext}`);
  }
});

const createUploadImagesMiddleware = ({ maxSizeBytes, maxFiles, allowedTypes }) =>
  multer({
    storage: uploadStorage,
    limits: {
      fileSize: maxSizeBytes,
      files: maxFiles
    },
    fileFilter: (_req, file, cb) => {
      const ext = getAllowedExtension(file.originalname);
      if (!new Set(allowedTypes).has(file.mimetype) || !ext) {
        cb(new Error('INVALID_FILE_TYPE'));
        return;
      }
      cb(null, true);
    }
  });

const {
  port,
  host,
  metisBaseUrl,
  defaultModel,
  metisApiKey,
  defaultTimeoutMs,
  geminiApiKey,
  geminiImageModel,
  geminiBaseUrl,
  ai,
  adminApiKey,
  adminJwtSecret,
  authJwtSecret,
  adminCookieName,
  adminConfigPath,
  systemPromptPath,
  frontendDistPath
} = loadRuntimeConfig(process.env);
const noaRepository = createNoaRepository(repositories.db);
const noaBillingService = createNoaBillingService({ repository: noaRepository });
const noaReceiptService = createNoaReceiptService({
  repository: noaRepository,
  billingService: noaBillingService
});
const noaReceiptStorage = createNoaReceiptStorage({
  rootDirectory: process.env.NOA_RECEIPT_STORAGE_DIR || path.join(uploadsDir, 'noa-receipts')
});
const noaUserRouter = createNoaUserRouter({
  billingService: noaBillingService,
  receiptService: noaReceiptService,
  receiptStorage: noaReceiptStorage,
  authMiddleware: createAuthMiddleware({
    jwtSecret: authJwtSecret,
    db: repositories.db
  })
});
try {
  fs.ensureDirSync(ai.image.storageDir);
} catch (error) {
  console.warn('[image-generation] storage directory is not writable at boot', {
    storageDir: ai.image.storageDir,
    message: error instanceof Error ? error.message : String(error)
  });
}
try {
  fs.ensureDirSync(ai.conversationMemory.storageDir);
} catch (error) {
  console.warn('[conversation-memory] storage directory is not writable at boot', {
    storageDir: ai.conversationMemory.storageDir,
    message: error instanceof Error ? error.message : String(error)
  });
}
const openaiClient = new OpenAI({
  apiKey: metisApiKey || 'missing-metis-api-key',
  baseURL: metisBaseUrl
});

const promptService = createPromptService({
  fileStore: fs,
  configPath: adminConfigPath,
  systemPromptPath,
  defaultModel,
  defaultTimeoutMs
});
const appSmsService = createSmsService({
  ippanelClient: axios.create({
    timeout: Number(process.env.IPPANEL_TIMEOUT_MS || 15000)
  }),
  ippanelApiKey: process.env.IPPANEL_API_KEY,
  ippanelPatternCode: process.env.IPPANEL_PATTERN_CODE,
  ippanelSender: process.env.IPPANEL_SENDER,
  otpExpireSeconds: Number.parseInt(process.env.OTP_EXPIRE || '120', 10),
  settingsRepository: repositories.settings,
  otpDevMock: process.env.OTP_DEV_MOCK === 'true',
  logger: console
});

const invalidateSystemPromptCache = () => {
  promptService.invalidateSystemPromptCache();
};

attachProcessErrorLogging();

console.log('[BOOT] DB mode=mysql');

app.use(cors({ origin: true, credentials: true }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:']
      }
    }
  })
);
app.use(compression({
  filter: (req, res) => {
    if (String(req.headers?.accept || '').toLowerCase().includes('application/x-ndjson')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.locals.requestId = requestId;

  const safeRequestPath = String(req.originalUrl || '').replace(/\/api\/video-provider-input\/[^/?\s]+/g, '/api/video-provider-input/[REDACTED]');
  log('HTTP', 'request_started', {
    requestId,
    method: req.method,
    path: safeRequestPath
  });

  res.on('finish', () => {
    log('HTTP', 'request_finished', {
      requestId,
      method: req.method,
      path: safeRequestPath,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

app.get('/api/settings/public', async (_req, res) => {
  const settings = await getAppSettings();
  return res.json({ settings });
});

app.post('/api/uploads/images', async (req, res) => {
  const uploadSettings = await getUploadSettings();
  const uploadImagesMiddleware = createUploadImagesMiddleware(uploadSettings);
  uploadImagesMiddleware.array('images', uploadSettings.maxFiles)(req, res, (error) => {
    if (error) {
      if (error.message === 'INVALID_FILE_TYPE') {
        console.warn('[UPLOAD][images][invalid_type]', {
          ip: req.ip,
          message: error.message
        });
        return res.status(400).json({
          error: 'INVALID_FILE_TYPE',
          message: 'Only jpg, jpeg, png, webp files are allowed.'
        });
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          console.warn('[UPLOAD][images][too_large]', {
            ip: req.ip,
            code: error.code
          });
          return res.status(413).json({
            error: 'FILE_TOO_LARGE',
            message: `Each file must be ${uploadSettings.maxSizeMb}MB or smaller.`
          });
        }
        if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
          console.warn('[UPLOAD][images][too_many]', {
            ip: req.ip,
            code: error.code
          });
          return res.status(400).json({
            error: 'TOO_MANY_FILES',
            message: `Maximum ${uploadSettings.maxFiles} files are allowed per upload.`
          });
        }
      }
      console.error('[UPLOAD][images][failed]', {
        ip: req.ip,
        error: error.message
      });
      return res.status(500).json({
        error: 'INTERNAL_UPLOAD_ERROR',
        message: 'Unexpected upload error.'
      });
    }

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const images = uploadedFiles.map((file) => ({
      imageId: path.parse(file.filename).name,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    }));

    console.log('[UPLOAD][images][success]', {
      ip: req.ip,
      count: images.length
    });

    return res.status(200).json({ images });
  });
});

app.get('/api/uploads/images/:imageId', async (req, res) => {
  const { imageId } = req.params;
  if (!imageIdPattern.test(imageId)) {
    return res.status(400).json({ error: 'INVALID_IMAGE_ID' });
  }

  const streamImage = (filePath, mimeType) => {
    res.type(mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return fs.createReadStream(filePath).pipe(res);
  };

  // 1. Check uploaded images (original pattern)
  for (const ext of allowedImageExtensions) {
    const candidate = path.join(uploadsDir, `${imageId}${ext}`);
    if (await fs.pathExists(candidate)) {
      if (ext === '.jpg' || ext === '.jpeg') {
        return streamImage(candidate, 'image/jpeg');
      } else if (ext === '.png') {
        return streamImage(candidate, 'image/png');
      } else if (ext === '.webp') {
        return streamImage(candidate, 'image/webp');
      }
    }
  }

  // Generated chat images are served through /api/images/serve/:taskId,
  // where task ownership is checked for logged-in users and guests.
  if (/^[1-9]\d*$|^0$/.test(imageId)) {
    return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
  }

  // Don't cache 404 — file might be created by concurrent request
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  console.warn('[UPLOAD][images][not_found]', { imageId });
  return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
});


const { router: authRouter } = createAuthModule({
  userRepository: repositories.users,
  guestsRepository: repositories.guests,
  smsService: appSmsService,
  jwt,
  jwtSecret: authJwtSecret,
  otpExpireSeconds: Number.parseInt(process.env.OTP_EXPIRE || '120', 10),
  dbPool: repositories.db,
  db: repositories.db,
  settingsRepository: repositories.settings,
  supervisedOtpRepository: repositories.supervisedOtp,
  eventsRepository: repositories.events,
  errorsRepository: {
    logError: (...args) => repositories.errors.logError(...args)
  },
  logger: console
});
app.use(authRouter);
app.use(createLocalDevelopmentRouter({
  enabled: process.env.LOCAL_DEV_SESSION_ENABLED === 'true',
  usersRepository: repositories.users,
  noaBillingService,
  jwt,
  jwtSecret: authJwtSecret,
  logger: console
}));
app.use('/api/noa', noaUserRouter);

const inputOptimizerService = createInputOptimizerService({
  httpClient: axios,
  settingsRepository: repositories.settings,
  optimizationRepository: repositories.inputOptimizations,
  optimizerConfig: ai.inputOptimizer,
  chatConfig: ai.chat,
  logger: console
});
const conversationTitleService = createConversationTitleService({
  httpClient: axios,
  settingsRepository: repositories.settings,
  conversationsRepository: repositories.conversations,
  titleConfig: ai.conversationTitle,
  chatConfig: ai.chat,
  logger: console
});

const imageGenerationModule = createImageGenerationRouter({
  httpClient: axios,
  geminiApiKey,
  geminiImageModel,
  geminiBaseUrl,
  imageConfig: ai.image,
  chatConfig: ai.chat,
  db: repositories.db,
  noaBillingService,
  settingsRepository: repositories.settings,
  conversationsRepository: repositories.conversations,
  eventsRepository: repositories.events,
  authJwtSecret,
  inputOptimizerService,
  conversationTitleService
});
app.use('/api/images', imageGenerationModule.publicRouter);
app.use('/api/images', imageGenerationModule.router);

const { createVideoGenerationRouter } = require('./modules/video-generation/video-generation.routes');
const videoGenerationModule = createVideoGenerationRouter({
  httpClient: axios,
  db: repositories.db,
  noaBillingService,
  authJwtSecret,
  adminJwtSecret,
  adminCookieName
});
app.use('/api/video-generations', videoGenerationModule.router);
app.use('/api/video-generation', videoGenerationModule.router);
app.use('/api/video-provider-input', videoGenerationModule.publicInputRouter);

const imageUnderstandingModule = createImageUnderstandingRouter({
  httpClient: axios,
  settingsRepository: repositories.settings,
  visionConfig: ai.vision,
  chatConfig: ai.chat,
  uploadedImagesRepository,
  imageGenerationController: imageGenerationModule.controller,
  db: repositories.db,
  logger: {
    log
  }
});
app.use('/api/vision', imageUnderstandingModule.router);

const intentRouterService = createIntentRouterService({
  httpClient: axios,
  settingsRepository: repositories.settings,
  routerConfig: ai.intentRouter,
  chatConfig: ai.chat,
  logger: console
});

const conversationMemoryService = createConversationMemoryService({
  db: repositories.db,
  fileStore: fs,
  storageRoot: ai.conversationMemory.storageDir,
  logger: console
});
const conversationContextBuilder = createConversationContextBuilder({
  conversationMemoryService
});
const conversationMemoryWriterService = createConversationMemoryWriterService({
  httpClient: axios,
  settingsRepository: repositories.settings,
  memoryConfig: ai.conversationMemory,
  chatConfig: ai.chat,
  conversationMemoryService,
  logger: console
});

app.use(createAiRouter({
  apiKey: metisApiKey,
  baseUrl: metisBaseUrl,
  openaiClient,
  httpClient: axios,
  promptService,
  usersRepository: repositories.users,
  conversationsRepository: repositories.conversations,
  chatMessagesRepository: repositories.chatMessages,
  chatTurnsRepository: repositories.chatTurns,
  noaBillingService,
  jwt,
  jwtSecret: authJwtSecret,
  eventsRepository: repositories.events,
  errorsRepository: repositories.errors,
  uploadedImagesRepository,
  settingsRepository: repositories.settings,
  intentRouterService,
  inputOptimizerService,
  conversationTitleService,
  conversationMemoryService,
  conversationContextBuilder,
  conversationMemoryWriterService,
  imageGenerationController: imageGenerationModule.controller,
  imageGenerationService: imageGenerationModule.imageGenerationService,
  imageUnderstandingService: imageUnderstandingModule.imageUnderstandingService,
  logger: {
    log
  }
}));


const { router: conversationRouter } = createConversationsModule({
  usersRepository: {
    ensureUserExists: (...args) => repositories.users.ensureUserExists(...args)
  },
  conversationsRepository: {
    getUserConversations: (...args) => repositories.conversations.getUserConversations(...args),
    replaceUserConversations: (...args) => repositories.conversations.replaceUserConversations(...args),
    ensureConversation: (...args) => repositories.conversations.ensureConversation(...args),
    setManualTitle: (...args) => repositories.conversations.setManualTitle(...args),
    conversationExists: (...args) => repositories.conversations.conversationExists(...args)
  },
  conversationMemoryService,
  errorsRepository: {
    logError: (...args) => repositories.errors.logError(...args)
  },
  now,
  resolveOwner: async (req) => {
    const authorization = String(req.headers?.authorization || '');
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (token) {
      try {
        const payload = jwt.verify(token, authJwtSecret);
        const userId = String(payload?.sub || '').trim();
        if (userId) return { userId, type: 'authenticated' };
      } catch (_error) {
        return null;
      }
    }
    const guestId = String(req.cookies?.danoa_guest_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(guestId)) return null;
    return { userId: await repositories.guests.ensureGuestUser(guestId), type: 'guest' };
  }
});
app.use('/api/conversations', conversationRouter);

app.use(createSmsRouter({
  smsService: appSmsService,
  logger: console
}));
console.log('[SMS] routes mounted');

const adminModule = createAdminRouter({
  jwtSecret: adminJwtSecret,
  cookieName: adminCookieName,
  onSystemPromptUpdated: invalidateSystemPromptCache,
  adminApiKey,
  repositories,
  runtimeConfig: { ai },
  imageRuntimeSettingsResolver: imageGenerationModule.imageRuntimeSettingsResolver,
  imageGenerationService: imageGenerationModule.imageGenerationService,
  imagePromptRefinerService: imageGenerationModule.imagePromptRefinerService,
  imageUnderstandingService: imageUnderstandingModule.imageUnderstandingService,
  intentRouterService,
  inputOptimizerService,
  conversationMemoryService,
  conversationMemoryWriterService,
  aiRouteResolver: videoGenerationModule.routeResolver,
  noaBillingService
});
app.use('/api/admin/noa', createNoaAdminRouter({
  billingService: noaBillingService,
  receiptService: noaReceiptService,
  receiptStorage: noaReceiptStorage,
  requireAdminAuth: adminModule.requireAdminAuth,
  appendAudit: adminModule.appendAudit,
  logger: console
}));
app.use('/api/admin', adminModule.router);

app.use(createHealthRouter({
  httpClient: axios,
  metisBaseUrl,
  metisApiKey,
  defaultModel,
  db: repositories.db,
  env: process.env,
  videoWorkerState: () => {
    const state = videoWorkerRuntime?.getState?.();
    return { enabled: Boolean(state?.enabled), mode: state?.mode || 'disabled', state: state?.state || 'disabled' };
  }
}));

app.use(express.static(frontendDistPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// ─── Global error handler (must be LAST, after all routes) ───
app.use((err, req, res, _next) => {
  const requestId = res.locals.requestId || 'unknown';
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[ERROR][${requestId}]`, {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    status: err.status || err.statusCode || null,
    code: err.code || null
  });

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: isProd ? 'خطای داخلی سرور' : err.message,
    requestId
  });
});

// ─── DB-first startup; importing this module never starts HTTP or a worker. ───
async function startServer({ installSignalHandlers = true } = {}) {
  let server;
  let noaExpiryTimer = null;
  let shutdownPromise = null;
  const shutdown = async () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      await videoWorkerRuntime?.stop?.();
      if (noaExpiryTimer) clearInterval(noaExpiryTimer);
      if (server) await new Promise((resolve) => server.close(resolve));
      await repositories.db.close();
    })();
    return shutdownPromise;
  };
  try {
    await repositories.db.init();
    await conversationMemoryService.ensureMetadataTables();
    await conversationMemoryService.ensureStorageRoot();
    console.log('[BOOT] Database initialized');
    if (String(process.env.BALE_MONITOR_ENABLED || '0') === '1') initBaleMonitor(app);
    else console.log('[BALE] monitor disabled');
    videoWorkerRuntime = createConfiguredVideoWorkerRuntime({
      db: repositories.db,
      httpClient: axios,
      noaBillingService,
      env: process.env,
      role: 'embedded',
      logger: console
    });
    await videoWorkerRuntime.start();
    const sweepExpiredNoaReservations = async () => {
      const released = await noaBillingService.releaseExpiredReservations({ limit: 250 });
      const reconciled = await reconcileExpiredNoaOperations(repositories.db);
      return { released, reconciled };
    };
    await sweepExpiredNoaReservations().catch((error) => {
      console.error('[NOA] Initial reservation cleanup failed:', error.message);
    });
    noaExpiryTimer = setInterval(() => {
      sweepExpiredNoaReservations().catch((error) => {
        console.error('[NOA] Reservation cleanup failed:', error.message);
      });
    }, 60_000);
    noaExpiryTimer.unref?.();
  } catch (err) {
    console.error('[BOOT] Database initialization failed:', err.message);
    throw err;
  }

  server = app.listen(port, host, () => {
    log('BOOT', 'backend_started', {
      host,
      port,
      model: defaultModel,
      baseUrl: metisBaseUrl,
      timeoutMs: defaultTimeoutMs
    });
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = Math.max(190000, Number(ai.vision?.timeoutMs || 45000) + 15000);
  if (installSignalHandlers && !serverSignalHandlersInstalled) {
    serverSignalHandlersInstalled = true;
    const handler = async () => { await shutdown(); process.exit(0); };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }
  return { app, server, videoWorkerRuntime, shutdown };
}

if (require.main === module) {
  startServer().catch(() => { process.exitCode = 1; });
}

module.exports = { app, startServer };
