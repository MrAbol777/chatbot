const express = require('express');
const rateLimit = require('express-rate-limit');
const { createAiController } = require('./ai.controller');
const { createAiService } = require('./ai.service');
const { createRequirePrincipal } = require('../auth/principal');
const { createUploadOwnershipGuard } = require('../uploads/upload-ownership.middleware');
const { createChatConcurrencyGate, positiveInteger } = require('./chat-pressure.middleware');

function createAiRouter(deps) {
  const router = express.Router();
  const aiService = deps.aiService || createAiService(deps);
  const controller = createAiController({
    aiService,
    errorsRepository: deps.errorsRepository,
    usersRepository: deps.usersRepository,
    chatTurnsRepository: deps.chatTurnsRepository,
    conversationsRepository: deps.conversationsRepository,
    uploadedImagesRepository: deps.uploadedImagesRepository,
    intentRouterService: deps.intentRouterService,
    inputOptimizerService: deps.inputOptimizerService,
    conversationTitleService: deps.conversationTitleService,
    conversationMemoryService: deps.conversationMemoryService,
    conversationContextBuilder: deps.conversationContextBuilder,
    conversationMemoryWriterService: deps.conversationMemoryWriterService,
    imageGenerationController: deps.imageGenerationController,
    imageGenerationService: deps.imageGenerationService,
    imageUnderstandingService: deps.imageUnderstandingService,
    noaBillingService: deps.noaBillingService,
    jwt: deps.jwt,
    jwtSecret: deps.jwtSecret,
    principalResolver: deps.principalResolver
  });
  const uploadOwnershipGuard = createUploadOwnershipGuard({
    principalResolver: deps.principalResolver,
    uploadedImagesRepository: deps.uploadedImagesRepository
  });
  const requirePrincipal = deps.principalResolver?.resolve
    ? createRequirePrincipal(deps.principalResolver)
    : (_req, _res, next) => next();
  const chatRateLimiter = rateLimit({
    windowMs: 60_000,
    max: positiveInteger(process.env.CHAT_RATE_LIMIT_PER_MINUTE, 30),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.id || req.ip),
    handler: (_req, res) => res.status(429).json({
      error: 'CHAT_RATE_LIMITED',
      message: 'درخواست‌های گفتگو خیلی سریع ارسال شده‌اند. کمی بعد دوباره امتحان کن.'
    })
  });
  const chatConcurrencyGate = createChatConcurrencyGate({
    maxPerUser: process.env.CHAT_MAX_CONCURRENT_PER_USER || 2,
    maxGlobal: process.env.CHAT_MAX_CONCURRENT_GLOBAL || 20
  });

  router.post(
    '/api/chat',
    requirePrincipal,
    chatRateLimiter,
    chatConcurrencyGate,
    uploadOwnershipGuard,
    controller.postChat
  );

  return router;
}

module.exports = { createAiRouter };
