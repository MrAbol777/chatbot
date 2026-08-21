const path = require('path');
const { DatabaseClient } = require('./DatabaseClient');
const { UserRepository } = require('./UserRepository');
const { ConversationRepository } = require('./ConversationRepository');
const { EventRepository } = require('./EventRepository');
const { ErrorRepository } = require('./ErrorRepository');
const { AnalyticsRepository } = require('./AnalyticsRepository');
const { SettingsRepository } = require('./SettingsRepository');
const { ChatMessageRepository } = require('./ChatMessageRepository');
const { SupervisedOtpRepository } = require('./SupervisedOtpRepository');
const { ChatTurnRepository } = require('./ChatTurnRepository');
const { InputOptimizationRepository } = require('./InputOptimizationRepository');
const AdminRepository = require('./AdminRepository');
const { createBroadcastMessagesRepository } = require('../modules/broadcast-messages/broadcast-messages.repository');

function createRepositories() {
  const db = new DatabaseClient({
    databaseUrl: typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '',
    databaseHost: process.env.NODE_ENV === 'development'
      ? process.env.LOCAL_DATABASE_HOST
      : ''
  });

  const users = new UserRepository(db);
  const conversations = new ConversationRepository(db);
  const events = new EventRepository(db);
  const errors = new ErrorRepository(db);
  const analytics = new AnalyticsRepository(db, {
    auditLogPath: path.join(__dirname, '../../audit.log')
  });
  const settings = new SettingsRepository(db);
  const chatMessages = new ChatMessageRepository(db);
  const supervisedOtp = new SupervisedOtpRepository(db);
  const chatTurns = new ChatTurnRepository(db);
  const inputOptimizations = new InputOptimizationRepository(db);
  const admins = new AdminRepository(db);
  const broadcastMessages = createBroadcastMessagesRepository(db);

  return {
    db,
    users,
    conversations,
    events,
    errors,
    analytics,
    settings,
    chatMessages,
    chatTurns,
    inputOptimizations,
    supervisedOtp,
    admins,
    broadcastMessages
  };
}

module.exports = { createRepositories };
