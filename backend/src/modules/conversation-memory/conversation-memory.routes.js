const express = require('express');
const { createConversationMemoryController } = require('./conversation-memory.controller');

function createConversationMemoryAdminRouter({
  requireAdminAuth,
  conversationMemoryService,
  conversationsRepository,
  chatMessagesRepository
}) {
  const router = express.Router();
  const controller = createConversationMemoryController({
    conversationMemoryService,
    conversationsRepository,
    chatMessagesRepository
  });

  router.get('/conversations/:conversationId/memory', requireAdminAuth, controller.getMemory);
  router.post('/conversations/:conversationId/memory/reset', requireAdminAuth, controller.resetMemory);
  router.post('/conversations/:conversationId/memory/rebuild', requireAdminAuth, controller.rebuildMemory);
  router.get('/conversations/:conversationId/memory/download', requireAdminAuth, controller.downloadMemory);

  return router;
}

module.exports = { createConversationMemoryAdminRouter };
