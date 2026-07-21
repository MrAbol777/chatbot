class VideoGenerationError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => new VideoGenerationError(code, message, status);
module.exports = { VideoGenerationError, fail };
