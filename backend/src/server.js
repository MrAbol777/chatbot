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
const { createPromptService } = require('./modules/ai/prompt.service');
const { createAuthModule } = require('./modules/auth/auth.module');
const { createConversationsModule } = require('./modules/conversations');
const { createRepositories } = require('./repositories');

const app = express();
const repositories = createRepositories();
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
  adminApiKey,
  adminJwtSecret,
  authJwtSecret,
  adminCookieName,
  adminConfigPath,
  systemPromptPath,
  frontendDistPath
} = loadRuntimeConfig(process.env);
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
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.locals.requestId = requestId;

  log('HTTP', 'request_started', {
    requestId,
    method: req.method,
    path: req.originalUrl
  });

  res.on('finish', () => {
    log('HTTP', 'request_finished', {
      requestId,
      method: req.method,
      path: req.originalUrl,
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

  // 2. Check generated images: uploads/images-generated/{id}.{ext}
  for (const ext of allowedImageExtensions) {
    const generatedPath = path.join(generatedImagesDir, `${imageId}${ext}`);
    if (await fs.pathExists(generatedPath)) {
      return streamImage(generatedPath, imageMimeTypeByExtension[ext]);
    }
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
  errorsRepository: {
    logError: (...args) => repositories.errors.logError(...args)
  },
  logger: console
});
app.use(authRouter);

app.use(createAiRouter({
  apiKey: metisApiKey,
  baseUrl: metisBaseUrl,
  openaiClient,
  httpClient: axios,
  promptService,
  usersRepository: repositories.users,
  conversationsRepository: repositories.conversations,
  guestsRepository: repositories.guests,
  plansRepository: repositories.plans,
  jwt,
  jwtSecret: authJwtSecret,
  eventsRepository: repositories.events,
  errorsRepository: repositories.errors,
  uploadedImagesRepository,
  settingsRepository: repositories.settings,
  logger: {
    log
  }
}));

const imageGenerationModule = createImageGenerationRouter({
  httpClient: axios,
  geminiApiKey,
  geminiImageModel,
  geminiBaseUrl,
  db: repositories.db,
  plansRepository: repositories.plans,
  authJwtSecret
});
// Public serve endpoint (no auth — img tags can't send Authorization headers)
app.use('/api/images', imageGenerationModule.publicRouter);
// Protected endpoints (generate, status)
app.use('/api/images', imageGenerationModule.router);


const { router: conversationRouter } = createConversationsModule({
  usersRepository: {
    ensureUserExists: (...args) => repositories.users.ensureUserExists(...args)
  },
  conversationsRepository: {
    getUserConversations: (...args) => repositories.conversations.getUserConversations(...args),
    replaceUserConversations: (...args) => repositories.conversations.replaceUserConversations(...args)
  },
  errorsRepository: {
    logError: (...args) => repositories.errors.logError(...args)
  },
  now
});
app.use('/api/conversations', conversationRouter);

app.get('/api/subscription-plans', async (_req, res) => {
  try {
    const plans = await repositories.plans.listPlans({ activeOnly: true });
    return res.json({ plans, updatedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت پلن‌ها' });
  }
});

app.use(createSmsRouter({
  smsService: appSmsService,
  logger: console
}));
console.log('[SMS] routes mounted');

const { router: adminRouter } = createAdminRouter({
  jwtSecret: adminJwtSecret,
  cookieName: adminCookieName,
  onSystemPromptUpdated: invalidateSystemPromptCache,
  adminApiKey,
  repositories
});
app.use('/api/admin', adminRouter);

app.use(createHealthRouter({
  httpClient: axios,
  metisBaseUrl,
  metisApiKey,
  defaultModel
}));

initBaleMonitor(app);

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

// ─── Wait for DB initialization before starting server ───
(async () => {
  try {
    await repositories.db.init();
    console.log('[BOOT] Database initialized');
  } catch (err) {
    console.error('[BOOT] Database initialization failed:', err.message);
    process.exit(1);
  }

  const server = app.listen(port, host, () => {
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
  server.requestTimeout = 30000;
})();
