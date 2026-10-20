const express = require('express');
const { createAiController } = require('./ai.controller');
const { createAiService } = require('./ai.service');
const { createAuthMiddleware } = require('../image-generation/auth.middleware');
const { createFollowupSuggestionsService } = require('./followup-suggestions.service');

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

  router.post('/api/chat', controller.postChat);

  const requireUser = createAuthMiddleware({
    jwtSecret: deps.jwtSecret,
    db: deps.db,
    principalResolver: deps.principalResolver
  });
  const followupService = createFollowupSuggestionsService({
    aiService,
    chatTurnsRepository: deps.chatTurnsRepository,
    usersRepository: deps.usersRepository
  });
  const bodyText = (value) => (typeof value === 'string' ? value.trim() : '');

  router.post('/api/chat/feedback', requireUser, async (req, res) => {
    const turnId = bodyText(req.body?.turnId);
    const rating = req.body?.rating === null ? null : req.body?.rating;
    if (!turnId || (rating !== null && rating !== 'up' && rating !== 'down')) {
      return res.status(400).json({ success: false, error: 'INVALID_FEEDBACK' });
    }
    try {
      const turn = await deps.chatTurnsRepository.getTurn(turnId);
      if (!turn || String(turn.user_id) !== req.user.id) {
        return res.status(404).json({ success: false, error: 'TURN_NOT_FOUND' });
      }
      const saved = await deps.chatFeedbackRepository.setFeedback({
        userId: req.user.id,
        turnId,
        conversationId: turn.conversation_id,
        rating
      });
      return res.json({ success: true, ...saved });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'FEEDBACK_FAILED' });
    }
  });

  router.post('/api/chat/followups', requireUser, async (req, res) => {
    const turnId = bodyText(req.body?.turnId);
    if (!turnId) return res.status(400).json({ success: false, error: 'INVALID_TURN_ID' });
    try {
      const suggestions = await followupService.suggestForTurn({
        userId: req.user.id,
        turnId,
        requestId: `followups-${turnId}`
      });
      return res.json({ success: true, suggestions });
    } catch (error) {
      const status = error?.code === 'TURN_NOT_FOUND' ? 404 : error?.code === 'RATE_LIMITED' ? 429 : 500;
      return res.status(status).json({ success: false, error: error?.code || 'FOLLOWUPS_FAILED' });
    }
  });

  return router;
}

module.exports = { createAiRouter };
