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
const { createPromptService } = require('./modules/ai/prompt.service');
const { createAuthModule } = require('./modules/auth/auth.module');
const { createConversationsModule } = require('./modules/conversations');
const { createRepositories } = require('./repositories');

const app = express();
const repositories = createRepositories();

const {
  port,
  host,
  metisBaseUrl,
  defaultModel,
  metisApiKey,
  defaultTimeoutMs,
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
  logger: console
});

const invalidateSystemPromptCache = () => {
  promptService.invalidateSystemPromptCache();
};

attachProcessErrorLogging();

console.log('[BOOT] DB mode=mysql');

app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
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


const { router: authRouter } = createAuthModule({
  userRepository: repositories.users,
  smsService: appSmsService,
  jwt,
  jwtSecret: authJwtSecret,
  otpExpireSeconds: Number.parseInt(process.env.OTP_EXPIRE || '120', 10),
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
  eventsRepository: repositories.events,
  errorsRepository: repositories.errors,
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
    replaceUserConversations: (...args) => repositories.conversations.replaceUserConversations(...args)
  },
  errorsRepository: {
    logError: (...args) => repositories.errors.logError(...args)
  },
  now
});
app.use('/api/conversations', conversationRouter);

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
