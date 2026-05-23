class EventRepository {
  constructor(db) {
    this.db = db;
  }

  async logEvent(userId, eventType, category, metadata) {
    await this.db.init();
    if (!userId || !eventType) return;

    const ts = new Date();
    await this.db.query(
      'INSERT INTO app_events (user_id, event_type, category, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
      [
        String(userId),
        String(eventType),
        category ? String(category) : null,
        JSON.stringify(metadata || {}),
        ts
      ]
    );
    await this.db.query('UPDATE app_users SET last_active = ? WHERE user_id = ?', [ts, String(userId)]);
  }
}

module.exports = { EventRepository };
