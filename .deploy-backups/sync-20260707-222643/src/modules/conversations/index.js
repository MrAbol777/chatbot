const { createConversationsService } = require('./service');
const { createConversationsRouter } = require('./routes');

function createConversationsModule({ usersRepository, conversationsRepository, errorsRepository, now }) {
  const conversationsService = createConversationsService({
    usersRepository,
    conversationsRepository,
    errorsRepository,
    now
  });

  const router = createConversationsRouter({ conversationsService });

  return {
    router,
    conversationsService
  };
}

module.exports = { createConversationsModule };
