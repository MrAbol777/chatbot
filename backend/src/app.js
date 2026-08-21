const express = require('express');
const cors = require('cors');
const compression = require('compression');
const axios = require('axios');
const OpenAI = require('openai');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const { now, log } = require('./bootstrap/logging');
const { createAdminRouter } = require('./adminRoutes');
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
const { createSessionRepository } = require('./modules/auth/session.repository');
const { createPrincipalResolver } = require('./modules/auth/principal');
const { createVianaRepository } = require('./modules/auth/viana.repository');
const { createVianaService } = require('./modules/auth/viana.service');
const { createVianaRouter } = require('./modules/auth/viana.routes');
const { createSessionRouter } = require('./modules/auth/session.routes');
const { createConversationsModule } = require('./modules/conversations');
const { createVideoGenerationRouter } = require('./modules/video-generation/video-generation.routes');
const { createVideoGenerationAdminRouter } = require('./modules/video-generation/video-generation.admin.routes');
const {
  createNoaAdminRouter,
  createNoaBillingService,
  createNoaReceiptService,
  createNoaReceiptStorage,
  createNoaRepository,
  createNoaUserRouter
} = require('./modules/noa');

function createApp({ repositories, runtimeConfig }) {
  const app = express();
  const {
    metisBaseUrl,
    defaultModel,
    metisApiKey,
    geminiApiKey,
    geminiImageModel,
    geminiBaseUrl,
    ai,
    adminApiKey,
    adminJwtSecret,
    authJwtSecret,
    adminCookieName,
    viana,
    frontendDistPath
  } = runtimeConfig;

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

  const sessionRepository = createSessionRepository({
    db: repositories.db,
    csrfSecret: authJwtSecret,
    idleTimeoutSeconds: viana.sessionIdleTimeoutSeconds,
    absoluteTimeoutSeconds: viana.sessionAbsoluteTimeoutSeconds
  });
  const principalResolver = createPrincipalResolver({
    jwt,
    jwtSecret: authJwtSecret,
    usersRepository: repositories.users,
    sessionRepository,
    sessionCookieName: viana.sessionCookieName
  });
  const vianaRepository = createVianaRepository({ db: repositories.db });
  const vianaService = viana.enabled ? createVianaService({ config: viana }) : null;
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
      db: repositories.db,
      principalResolver
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

  const promptService = createPromptService({
    fs,
    defaultConfig: { systemPrompt: 'You are Hemraz, a helpful Persian AI assistant.' },
    configFilePath: path.join(__dirname, '../data/config.json'),
    systemPromptFilePath: path.join(__dirname, '../data/system_prompt.txt')
  });

  const invalidateSystemPromptCache = () => {
    promptService.invalidateCache();
  };

  const appSmsService = createSmsService({
    ippanelClient: axios,
    ippanelApiKey: process.env.IPPANEL_API_KEY || process.env.SMS_API_KEY,
    ippanelSender: process.env.IPPANEL_SENDER || process.env.SMS_LINENUMBER,
    ippanelPatternCode: process.env.IPPANEL_PATTERN_CODE || process.env.SMS_TEMPLATE_ID,
    otpDevMock: process.env.SMS_DEBUG_MODE === 'true',
    logger: console
  });

  const authModule = createAuthModule({
    usersRepository: repositories.users,
    jwtSecret: authJwtSecret,
    jwt,
    smsService: appSmsService,
    supervisedOtpRepository: repositories.supervisedOtp,
    logger: console
  });

  const openaiClient = new OpenAI({
    baseURL: metisBaseUrl,
    apiKey: metisApiKey
  });

  // Express Middlewares
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));
  app.use(cookieParser());
  app.use(compression({
    filter: (req, res) => {
      if (req.path === '/api/chat') return false;
      return compression.filter(req, res);
    }
  }));

  const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  const defaultAllowedOrigins = isProduction
    ? ['https://danoa.ir', 'https://www.danoa.ir']
    : [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ];
  const allowedOrigins = Array.from(new Set([
    ...defaultAllowedOrigins,
    ...configuredCorsOrigins
  ]));

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS blocked for this origin'), false);
    },
    credentials: true
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Upload Router
  const uploadRouter = express.Router();
  uploadRouter.post('/images', async (req, res) => {
    const uploadSettings = await getUploadSettings();
    const uploadMiddleware = createUploadImagesMiddleware(uploadSettings).array('images', uploadSettings.maxFiles);

    uploadMiddleware(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `حجم هر تصویر نباید بیشتر از ${uploadSettings.maxSizeMb} مگابایت باشد.` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: `حداکثر ${uploadSettings.maxFiles} تصویر می‌توانید ارسال کنید.` });
        }
        if (err.message === 'INVALID_FILE_TYPE') {
          return res.status(400).json({ error: 'فرمت تصویر مجاز نیست. فقط JPG، PNG و WEBP پشتیبانی می‌شود.' });
        }
        return res.status(400).json({ error: 'خطا در بارگذاری تصویر.' });
      }

      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'هیچ تصویری ارسال نشده است.' });
      }

      const images = files.map((file) => {
        const ext = getAllowedExtension(file.filename);
        const imageId = path.basename(file.filename, ext || path.extname(file.filename));
        return {
          imageId,
          mimeType: file.mimetype,
          size: file.size
        };
      });

      return res.json({ images });
    });
  });
  app.use('/api/upload', uploadRouter);

  // Auth & Session routes
  app.use('/api/auth', authModule.router);
  app.use('/api/auth/local', createLocalDevelopmentRouter({
    enabled: Boolean(process.env.ENABLE_LOCAL_DEV_LOGIN === 'true' || process.env.NODE_ENV !== 'production'),
    usersRepository: repositories.users,
    jwtSecret: authJwtSecret,
    jwt,
    logger: console
  }));

  if (viana.enabled && vianaService) {
    app.use(createVianaRouter({
      config: viana,
      vianaService,
      vianaRepository,
      sessionRepository,
      jwtSecret: authJwtSecret,
      logger: console
    }));
  }

  app.use(createSessionRouter({
    config: viana,
    sessionRepository,
    principalResolver,
    jwtSecret: authJwtSecret,
    logger: console
  }));
  app.use('/api/noa', noaUserRouter);

  // Input optimizer & conversation title
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

  // Image generation
  const imageGenerationModule = createImageGenerationRouter({
    httpClient: axios,
    geminiApiKey,
    geminiImageModel,
    geminiBaseUrl,
    imageConfig: ai.image,
    chatConfig: ai.chat,
    db: repositories.db,
    noaBillingService,
    principalResolver,
    settingsRepository: repositories.settings,
    conversationsRepository: repositories.conversations,
    eventsRepository: repositories.events,
    authJwtSecret,
    inputOptimizerService,
    conversationTitleService
  });
  app.use('/api/images', imageGenerationModule.publicRouter);
  app.use('/api/images', imageGenerationModule.router);

  // Video generation
  const videoGenerationModule = createVideoGenerationRouter({
    httpClient: axios,
    db: repositories.db,
    noaBillingService,
    authJwtSecret,
    principalResolver,
    adminJwtSecret,
    adminCookieName
  });
  app.use('/api/video-generations', videoGenerationModule.router);
  app.use('/api/video-generation', videoGenerationModule.router);
  app.use('/api/video-provider-input', videoGenerationModule.publicInputRouter);

  // Image understanding / vision
  const imageUnderstandingModule = createImageUnderstandingRouter({
    httpClient: axios,
    settingsRepository: repositories.settings,
    visionConfig: ai.vision,
    chatConfig: ai.chat,
    uploadedImagesRepository,
    imageGenerationController: imageGenerationModule.controller,
    noaBillingService,
    principalResolver,
    db: repositories.db,
    logger: { log }
  });
  app.use('/api/vision', imageUnderstandingModule.router);

  // Intent router & Conversation memory
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

  // AI Chat & streaming
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
    principalResolver,
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
    logger: { log }
  }));

  // Conversations router
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
      const resolution = await principalResolver.resolve(req);
      if (resolution.error) return { error: resolution.error };
      if (resolution.principal) {
        return { userId: resolution.principal.userId, type: 'authenticated' };
      }
      return null;
    }
  });
  app.use('/api/conversations', conversationRouter);

  // SMS routes
  app.use(createSmsRouter({
    smsService: appSmsService,
    logger: console
  }));

  // Admin routes
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
    usersRepository: repositories.users,
    requireAdminAuth: adminModule.requireAdminAuth,
    appendAudit: adminModule.appendAudit,
    logger: console
  }));
  app.use('/api/admin/video-generations', createVideoGenerationAdminRouter({
    db: repositories.db,
    requireAdminAuth: adminModule.requireAdminAuth,
    inputMediaStorage: videoGenerationModule.inputMedia.storage,
    logger: console
  }));
  app.use('/api/admin', adminModule.router);

  // Health route
  let videoWorkerRuntimeGetter = () => null;
  app.use(createHealthRouter({
    httpClient: axios,
    metisBaseUrl,
    metisApiKey,
    defaultModel,
    db: repositories.db,
    env: process.env,
    videoWorkerState: () => {
      const state = videoWorkerRuntimeGetter()?.getState?.();
      return { enabled: Boolean(state?.enabled), mode: state?.mode || 'disabled', state: state?.state || 'disabled' };
    }
  }));

  // Static Assets & SPA Fallback
  app.use('/brand', express.static(path.join(frontendDistPath, 'brand'), {
    maxAge: '1y',
    immutable: true
  }));
  app.use(express.static(frontendDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });

  // Global Error Handler
  app.use((err, req, res, _next) => {
    const requestId = res.locals.requestId || 'unknown';
    const isProd = process.env.NODE_ENV === 'production';

    console.error(`[ERROR][${requestId}]`, {
      message: err.message,
      stack: err.stack,
      path: req.path,
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

  return {
    app,
    noaBillingService,
    conversationMemoryService,
    videoGenerationModule,
    setVideoWorkerRuntimeGetter: (getter) => {
      videoWorkerRuntimeGetter = getter;
    }
  };
}

module.exports = { createApp };
