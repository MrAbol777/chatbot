const path = require('path');
const { DatabaseClient } = require('./DatabaseClient');
const { UserRepository } = require('./UserRepository');
const { ConversationRepository } = require('./ConversationRepository');
const { EventRepository } = require('./EventRepository');
const { ErrorRepository } = require('./ErrorRepository');
const { AnalyticsRepository } = require('./AnalyticsRepository');
const { GuestRepository } = require('./GuestRepository');
const { SettingsRepository } = require('./SettingsRepository');
const { PlanRepository } = require('./PlanRepository');
const { ChatMessageRepository } = require('./ChatMessageRepository');
const { SupervisedOtpRepository } = require('./SupervisedOtpRepository');

function createRepositories() {
  const db = new DatabaseClient({
    databaseUrl: typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : ''
  });

  const users = new UserRepository(db);
  const conversations = new ConversationRepository(db);
  const events = new EventRepository(db);
  const errors = new ErrorRepository(db);
  const analytics = new AnalyticsRepository(db, {
    auditLogPath: path.join(__dirname, '../../audit.log')
  });
  const guests = new GuestRepository(db);
  const settings = new SettingsRepository(db);
  const plans = new PlanRepository(db);
  const chatMessages = new ChatMessageRepository(db);
  const supervisedOtp = new SupervisedOtpRepository(db);

  return {
    db,
    users,
    conversations,
    events,
    errors,
    analytics,
    guests,
    settings,
    plans,
    chatMessages,
    supervisedOtp
  };
}

module.exports = { createRepositories };
