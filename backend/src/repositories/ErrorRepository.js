class ErrorRepository {
  constructor(db) {
    this.db = db;
  }

  async logError(errorType, endpoint, statusCode, details) {
    await this.db.init();
    await this.db.query(
      'INSERT INTO app_app_errors (error_type, endpoint, status_code, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [
        errorType ? String(errorType) : 'unknown',
        endpoint ? String(endpoint) : null,
        Number.isInteger(statusCode) ? statusCode : null,
        typeof details === 'string' ? details.slice(0, 3000) : JSON.stringify(details || {}),
        new Date()
      ]
    );
  }
}

module.exports = { ErrorRepository };
