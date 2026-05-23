const path = require('path');
const { DatabaseClient } = require('./DatabaseClient');
const { UserRepository } = require('./UserRepository');
const { ConversationRepository } = require('./ConversationRepository');
const { EventRepository } = require('./EventRepository');
const { ErrorRepository } = require('./ErrorRepository');
const { AnalyticsRepository } = require('./AnalyticsRepository');

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

  return {
    db,
    users,
    conversations,
    events,
    errors,
    analytics
  };
}

module.exports = { createRepositories };
