const express = require('express');
const { createConversationsController } = require('./controller');

function createConversationsRouter({ conversationsService, resolveOwner }) {
  const router = express.Router();
  const controller = createConversationsController({ conversationsService, resolveOwner });

  router.post('/', controller.create);
  router.post('/load', controller.load);
  router.post('/sync', controller.sync);
  router.patch('/:conversationId/title', controller.updateTitle);

  return router;
}

module.exports = { createConversationsRouter };
