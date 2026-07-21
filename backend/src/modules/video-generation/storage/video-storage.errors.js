class VideoStorageError extends Error {
  constructor(code, message = 'Video result storage failed.', { retryable = false } = {}) {
    super(message);
    this.name = 'VideoStorageError';
    this.code = code;
    this.retryable = retryable;
  }
}
module.exports = { VideoStorageError };
