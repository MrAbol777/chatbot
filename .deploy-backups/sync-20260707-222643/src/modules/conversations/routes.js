const express = require('express');
const { createConversationsController } = require('./controller');

function createConversationsRouter({ conversationsService }) {
  const router = express.Router();
  const controller = createConversationsController({ conversationsService });

  router.post('/load', controller.load);
  router.post('/sync', controller.sync);

  return router;
}

module.exports = { createConversationsRouter };
