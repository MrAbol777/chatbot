const express = require('express');
const { createConversationMemoryController } = require('./conversation-memory.controller');

function createConversationMemoryAdminRouter({
  requireAdminAuth,
  requireSensitiveAdminRole,
  conversationMemoryService,
  conversationsRepository,
  chatMessagesRepository
}) {
  const router = express.Router();
  if (typeof requireSensitiveAdminRole !== 'function') throw new Error('requireSensitiveAdminRole is required');

  const controller = createConversationMemoryController({
    conversationMemoryService,
    conversationsRepository,
    chatMessagesRepository
  });
  const guards = [requireAdminAuth, requireSensitiveAdminRole];

  router.get('/conversations/:conversationId/memory', ...guards, controller.getMemory);
  router.post('/conversations/:conversationId/memory/reset', ...guards, controller.resetMemory);
  router.post('/conversations/:conversationId/memory/rebuild', ...guards, controller.rebuildMemory);
  router.get('/conversations/:conversationId/memory/download', ...guards, controller.downloadMemory);

  return router;
}

module.exports = { createConversationMemoryAdminRouter };
