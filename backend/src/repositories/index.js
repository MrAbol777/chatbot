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
const { MonitoringRepository } = require('./MonitoringRepository');
const AdminRepository = require('./AdminRepository');
const { createBroadcastMessagesRepository } = require('../modules/broadcast-messages/broadcast-messages.repository');
const { SupportRepository } = require('../modules/support/support.repository');

function createRepositories() {
  const db = new DatabaseClient({
    databaseUrl: typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '',
    // LOCAL_DATABASE_HOST is intentionally an explicit opt-in override. It
    // lets a host-run Node process connect to a local MySQL instance while a
    // Docker deployment keeps using the hostname embedded in DATABASE_URL.
    databaseHost: process.env.LOCAL_DATABASE_HOST || process.env.DATABASE_HOST || ''
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
  const monitoring = new MonitoringRepository(db);
  const admins = new AdminRepository(db);
  const broadcastMessages = createBroadcastMessagesRepository(db);
  const support = new SupportRepository(db);

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
    monitoring,
    supervisedOtp,
    admins,
    broadcastMessages,
    support
  };
}

module.exports = { createRepositories };
