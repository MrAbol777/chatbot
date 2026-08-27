const express = require('express');
const fs = require('fs-extra');

const { createIntentRouterAdminRouter } = require('./modules/intent-router/intent-router.routes');
const { createConversationMemoryAdminRouter } = require('./modules/conversation-memory/conversation-memory.routes');
const { createAdminAnalyticsService } = require('./modules/admin/analytics/service');
const { createAdminAnalyticsRouter } = require('./modules/admin/analytics/routes');
const { createAdminSystemService } = require('./modules/admin/system/service');
const { createAdminSystemRouter } = require('./modules/admin/system/routes');
const { createAdminLogsService } = require('./modules/admin/logs/service');
const { createAdminLogsRouter } = require('./modules/admin/logs/routes');
const { createAdminSettingsService } = require('./modules/admin/settings/service');
const { createAdminSettingsRouter } = require('./modules/admin/settings/routes');
const { createAdminAiRoutingRouter } = require('./modules/ai-routing/admin-ai-routing.routes');
const { createVideoPromptProfileAdminRouter } = require('./modules/video-prompt-profiles/video-prompt-profile.routes');
const { createAdminAuthRouter } = require('./modules/admin/auth/routes');
const { createAdminUsersRouter } = require('./modules/admin/users/routes');
const { createAdminVisionRouter } = require('./modules/admin/vision/routes');
const { createAdminImageSettingsRouter } = require('./modules/admin/image-settings/routes');
const { createAdminSupervisedOtpRouter } = require('./modules/admin/otp/routes');
const { createAdminRuntimeStatusRouter } = require('./modules/admin/runtime-status/routes');
const { createAdminBroadcastMessagesRouter } = require('./modules/broadcast-messages/broadcast-messages.routes');
const { createMonitoringService } = require('./modules/admin/monitoring/service');
const { createMonitoringRouter } = require('./modules/admin/monitoring/routes');

const {
  createLoginLimiter,
  createRequireAdminAuth
} = require('./modules/admin/common/auth');
const {
  CONFIG_FILE_PATH,
  SYSTEM_PROMPT_PATH,
  DEFAULT_CONFIG,
  ensureAdminData,
  ensureConfigData,
  readAuditLogs,
  appendAudit
} = require('./modules/admin/common/storage');

function createAdminModule({
  jwtSecret,
  cookieName = 'admin_token',
  onSystemPromptUpdated,
  adminApiKey = '',
  repositories,
  runtimeConfig = {},
  imageRuntimeSettingsResolver,
  imageGenerationService,
  imagePromptRefinerService,
  imageUnderstandingService,
  intentRouterService,
  inputOptimizerService,
  conversationMemoryService,
  conversationMemoryWriterService,
  aiRouteResolver,
  noaBillingService
}) {
  const router = express.Router();
  const isSystemPromptEditEnabled = () => process.env.ENABLE_SYSTEM_PROMPT_EDIT !== 'false';
  const usersRepository = repositories?.users;
  const analyticsRepository = repositories?.analytics;
  const supervisedOtpRepository = repositories?.supervisedOtp;
  const broadcastMessagesRepository = repositories?.broadcastMessages;

  const loginLimiter = createLoginLimiter();
  const requireAdminAuth = createRequireAdminAuth({
    cookieName,
    jwtSecret
  });

  // 1. Auth routes (/login, /logout, /me)
  router.use(createAdminAuthRouter({
    jwtSecret,
    cookieName,
    loginLimiter,
    requireAdminAuth,
    ensureAdminData: () => ensureAdminData(repositories?.admins),
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  // 2. Users and moderation routes
  router.use(createAdminUsersRouter({
    requireAdminAuth,
    usersRepository,
    analyticsRepository,
    repositories,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  router.use(createAdminBroadcastMessagesRouter({
    requireAdminAuth,
    repository: broadcastMessagesRepository,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  // 3. Vision settings and test routes
  router.use(createAdminVisionRouter({
    requireAdminAuth,
    imageUnderstandingService,
    repositories,
    runtimeConfig,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  // 4. Image settings and prompt refiner routes
  router.use(createAdminImageSettingsRouter({
    requireAdminAuth,
    imageRuntimeSettingsResolver,
    imagePromptRefinerService,
    imageGenerationService,
    repositories,
    runtimeConfig,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  // 5. Supervised OTP routes
  router.use(createAdminSupervisedOtpRouter({
    requireAdminAuth,
    supervisedOtpRepository,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  // 6. AI Runtime Status and optimizations
  router.use(createAdminRuntimeStatusRouter({
    requireAdminAuth,
    repositories,
    runtimeConfig,
    imageRuntimeSettingsResolver,
    imagePromptRefinerService,
    imageUnderstandingService,
    intentRouterService,
    conversationMemoryWriterService
  }));

  const monitoringService = createMonitoringService({
    repository: repositories.monitoring,
    settingsRepository: repositories.settings,
    runtimeConfig,
    env: process.env
  });
  router.use(createMonitoringRouter({
    monitoringService,
    requireAdminAuth
  }));

  // 7. Analytics service & router
  const analyticsService = createAdminAnalyticsService({
    analyticsRepository: { readDB: (...args) => analyticsRepository.readDB(...args) },
    getTotalUsers: (...args) => analyticsRepository.getTotalUsers(...args),
    getActiveUsersToday: (...args) => analyticsRepository.getActiveUsersToday(...args),
    getApiCallsToday: (...args) => analyticsRepository.getApiCallsToday(...args),
    getErrorCountToday: (...args) => analyticsRepository.getErrorCountToday(...args),
    getUserGrowth: (...args) => analyticsRepository.getUserGrowth(...args),
    getApiUsage: (...args) => analyticsRepository.getApiUsage(...args),
    getErrorDistribution: (...args) => analyticsRepository.getErrorDistribution(...args),
    getRecentAuditLogs: (...args) => analyticsRepository.getRecentAuditLogs(...args),
    getStats: (...args) => analyticsRepository.getStats(...args),
    getSupervisedOtpUsage: (...args) => supervisedOtpRepository?.listUsage?.(...args)
  });
  router.use(createAdminAnalyticsRouter({
    analyticsService,
    adminApiKey,
    requireAdminAuth
  }));

  // 8. System prompt & configuration
  const systemService = createAdminSystemService({
    ensureConfigData,
    fileStore: fs,
    configFilePath: CONFIG_FILE_PATH,
    systemPromptFilePath: SYSTEM_PROMPT_PATH,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins),
    isSystemPromptEditEnabled,
    onSystemPromptUpdated,
    defaultConfig: DEFAULT_CONFIG,
    readJson: fs.readJson,
    writeJson: fs.writeJson
  });
  router.use(createAdminSystemRouter({
    systemService,
    requireAdminAuth
  }));

  // 9. Logs & audit service
  const logsService = createAdminLogsService({
    readDB: (...args) => analyticsRepository.readDB(...args),
    readAuditLogs: (opts) => readAuditLogs(repositories?.admins, opts)
  });
  router.use(createAdminLogsRouter({
    logsService,
    requireAdminAuth
  }));

  // 10. Settings service & router
  const settingsService = createAdminSettingsService({
    settingsRepository: repositories.settings,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins),
    onSettingsUpdated: async ({ changedKeys }) => {
      if (
        changedKeys.some((key) => String(key).startsWith('ai.image.')) &&
        imageRuntimeSettingsResolver &&
        typeof imageRuntimeSettingsResolver.invalidate === 'function'
      ) {
        imageRuntimeSettingsResolver.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.image.prompt_refiner.')) &&
        imagePromptRefinerService &&
        typeof imagePromptRefinerService.invalidate === 'function'
      ) {
        imagePromptRefinerService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.vision.')) &&
        imageUnderstandingService &&
        typeof imageUnderstandingService.invalidate === 'function'
      ) {
        imageUnderstandingService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.intent_router.')) &&
        intentRouterService &&
        typeof intentRouterService.invalidate === 'function'
      ) {
        intentRouterService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('input_optimizer.')) &&
        inputOptimizerService &&
        typeof inputOptimizerService.invalidate === 'function'
      ) {
        inputOptimizerService.invalidate();
      }
      if (
        changedKeys.some((key) => String(key).startsWith('ai.conversation_memory.')) &&
        conversationMemoryWriterService &&
        typeof conversationMemoryWriterService.invalidate === 'function'
      ) {
        conversationMemoryWriterService.invalidate();
      }
    }
  });
  router.use(createAdminSettingsRouter({
    settingsService,
    requireAdminAuth
  }));

  // 11. Intent router, conversation memory, AI routing, video prompt profiles
  router.use(createConversationMemoryAdminRouter({
    requireAdminAuth,
    conversationMemoryService,
    conversationsRepository: repositories.conversations,
    chatMessagesRepository: repositories.chatMessages
  }));
  router.use(createIntentRouterAdminRouter({
    intentRouterService,
    settingsRepository: repositories.settings,
    requireAdminAuth,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));
  router.use('/ai-routing', createAdminAiRoutingRouter({
    db: repositories.db,
    requireAdminAuth,
    routeResolver: aiRouteResolver,
    noaBillingService,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));
  router.use('/video-prompt-profiles', createVideoPromptProfileAdminRouter({
    db: repositories.db,
    requireAdminAuth,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins)
  }));

  return {
    router,
    requireAdminAuth,
    appendAudit: (entry) => appendAudit(entry, repositories?.admins),
    ensureAdminData: () => ensureAdminData(repositories?.admins),
    ensureConfigData
  };
}

function createAdminRouter(deps) {
  return createAdminModule(deps);
}

module.exports = {
  createAdminModule,
  createAdminRouter,
  ensureConfigData,
  ensureAdminData
};
