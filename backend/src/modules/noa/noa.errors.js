'use strict';

class NoaError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'NoaError';
    this.code = code;
    this.statusCode = statusCode;
    this.status = statusCode;
    if (details !== undefined) this.details = details;
  }
}

const noaError = (code, message, statusCode, details) =>
  new NoaError(code, message, statusCode, details);

const asNoaError = (error) => {
  if (error instanceof NoaError) return error;
  return noaError(
    'NOA_INTERNAL_ERROR',
    'عملیات مالی Noa ناموفق بود.',
    500,
    process.env.NODE_ENV === 'production'
      ? undefined
      : { cause: error instanceof Error ? error.message : String(error) }
  );
};

const sendNoaError = (res, error) => {
  const normalized = asNoaError(error);
  const payload = {
    success: false,
    error: normalized.code,
    message: normalized.message
  };
  if (normalized.details && typeof normalized.details === 'object') {
    Object.assign(payload, normalized.details);
  }
  return res.status(normalized.statusCode).json(payload);
};

module.exports = {
  NoaError,
  asNoaError,
  noaError,
  sendNoaError
};
