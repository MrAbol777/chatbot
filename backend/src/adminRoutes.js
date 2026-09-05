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
  ADMIN_ROLES,
  createLoginLimiter,
  createRequireAdminAuth,
  createRequireAdminRole
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
  const adminRepository = repositories?.admins;

  const loginLimiter = createLoginLimiter();
  const requireAdminAuth = createRequireAdminAuth({
    cookieName,
    jwtSecret,
    adminRepository
  });
  const requireSensitiveAdminRole = createRequireAdminRole([ADMIN_ROLES.ADMIN]);

  router.use(createAdminAuthRouter({
    jwtSecret,
    cookieName,
    loginLimiter,
    requireAdminAuth,
    ensureAdminData: () => ensureAdminData(adminRepository),
    appendAudit: (entry) => appendAudit(entry, adminRepository),
    revokeAdminSession: (entry) => adminRepository.revokeSession(entry)
  }));

  router.use(createAdminUsersRouter({
    requireAdminAuth,
    usersRepository,
    analyticsRepository,
    repositories,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));

  router.use(createAdminBroadcastMessagesRouter({
    requireAdminAuth,
    repository: broadcastMessagesRepository,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));

  router.use(createAdminVisionRouter({
    requireAdminAuth,
    imageUnderstandingService,
    repositories,
    runtimeConfig,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));

  router.use(createAdminImageSettingsRouter({
    requireAdminAuth,
    imageRuntimeSettingsResolver,
    imagePromptRefinerService,
    imageGenerationService,
    repositories,
    runtimeConfig,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));

  router.use(createAdminSupervisedOtpRouter({
    requireAdminAuth,
    supervisedOtpRepository,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));

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

  const systemService = createAdminSystemService({
    ensureConfigData,
    fileStore: fs,
    configFilePath: CONFIG_FILE_PATH,
    systemPromptFilePath: SYSTEM_PROMPT_PATH,
    appendAudit: (entry) => appendAudit(entry, adminRepository),
    isSystemPromptEditEnabled,
    onSystemPromptUpdated,
    defaultConfig: DEFAULT_CONFIG,
    readJson: fs.readJson,
    writeJson: fs.writeJson
  });
  router.use(createAdminSystemRouter({
    systemService,
    requireAdminAuth,
    requireSensitiveAdminRole
  }));

  const logsService = createAdminLogsService({
    readDB: (...args) => analyticsRepository.readDB(...args),
    readAuditLogs: (opts) => readAuditLogs(adminRepository, opts)
  });
  router.use(createAdminLogsRouter({
    logsService,
    requireAdminAuth
  }));

  const settingsService = createAdminSettingsService({
    settingsRepository: repositories.settings,
    appendAudit: (entry) => appendAudit(entry, adminRepository),
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
    requireAdminAuth,
    requireSensitiveAdminRole
  }));

  router.use(createConversationMemoryAdminRouter({
    requireAdminAuth,
    requireSensitiveAdminRole,
    conversationMemoryService,
    conversationsRepository: repositories.conversations,
    chatMessagesRepository: repositories.chatMessages
  }));
  router.use(createIntentRouterAdminRouter({
    intentRouterService,
    settingsRepository: repositories.settings,
    requireAdminAuth,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));
  router.use('/ai-routing', createAdminAiRoutingRouter({
    db: repositories.db,
    requireAdminAuth,
    routeResolver: aiRouteResolver,
    noaBillingService,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));
  router.use('/video-prompt-profiles', createVideoPromptProfileAdminRouter({
    db: repositories.db,
    requireAdminAuth,
    appendAudit: (entry) => appendAudit(entry, adminRepository)
  }));

  return {
    router,
    requireAdminAuth,
    appendAudit: (entry) => appendAudit(entry, adminRepository),
    ensureAdminData: () => ensureAdminData(adminRepository),
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
