const {
  normalizeIranMobileToInternational,
  getIranMobileVariants
} = require('../../shared/validators/phone.validator');

const DEFAULT_IPPANEL_SEND_URL = 'https://edge.ippanel.com/v1/api/send';
const DEFAULT_RESEND_COOLDOWN_MS = 60 * 1000;
const DEFAULT_MAX_WRONG_ATTEMPTS = 5;

function createSmsService({
  ippanelClient,
  ippanelSendUrl = DEFAULT_IPPANEL_SEND_URL,
  ippanelApiKey,
  ippanelPatternCode,
  ippanelSender,
  otpExpireSeconds = 120,
  settingsRepository,
  resendCooldownMs = DEFAULT_RESEND_COOLDOWN_MS,
  maxWrongAttempts = DEFAULT_MAX_WRONG_ATTEMPTS,
  otpDevMock = false,
  logger = console,
  now = () => new Date().toISOString(),
  setTimer = setInterval
}) {
  if (!ippanelClient || typeof ippanelClient.post !== 'function') {
    throw new Error('ippanelClient with a post method is required');
  }

  const otpStore = new Map();

  const getOtpSettings = async () => {
    if (!settingsRepository || typeof settingsRepository.getAll !== 'function') {
      return {
        expireSeconds: Number.isFinite(Number(otpExpireSeconds)) ? Number(otpExpireSeconds) : 120,
        resendCooldownMs: Number.isFinite(Number(resendCooldownMs)) ? Number(resendCooldownMs) : DEFAULT_RESEND_COOLDOWN_MS
      };
    }
    const settings = await settingsRepository.getAll();
    return {
      expireSeconds: Number.isFinite(Number(settings['auth.otp.expire_seconds']))
        ? Number(settings['auth.otp.expire_seconds'])
        : Number.isFinite(Number(otpExpireSeconds)) ? Number(otpExpireSeconds) : 120,
      resendCooldownMs: Number.isFinite(Number(settings['auth.otp.resend_cooldown_ms']))
        ? Number(settings['auth.otp.resend_cooldown_ms'])
        : Number.isFinite(Number(resendCooldownMs)) ? Number(resendCooldownMs) : DEFAULT_RESEND_COOLDOWN_MS
    };
  };

  const getRequiredConfig = (key, value) => {
    if (!value || !String(value).trim()) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return String(value).trim();
  };

  const validateOtpConfig = () => {
    const missing = [
      ['IPPANEL_API_KEY', ippanelApiKey],
      ['IPPANEL_PATTERN_CODE', ippanelPatternCode],
      ['IPPANEL_SENDER', ippanelSender]
    ].filter(([, value]) => !value || !String(value).trim());

    if (missing.length > 0) {
      const error = new Error(`Missing required env vars: ${missing.map(([key]) => key).join(', ')}`);
      error.statusCode = 500;
      throw error;
    }
  };

  const generateOtp = () => String(Math.floor(10000 + Math.random() * 90000));
  const classifyProviderFailure = (status) => {
    if (status === 429) return { category: 'rate_limited', retryable: true };
    if (status === 402) return { category: 'account_or_credit', retryable: false };
    if (status === 401 || status === 403) return { category: 'credentials_or_provider_config', retryable: false };
    if (Number.isInteger(status) && status >= 500) return { category: 'provider_unavailable', retryable: true };
    return { category: 'provider_request_rejected', retryable: false };
  };

  const getEndpointHost = () => {
    try {
      return new URL(ippanelSendUrl).host;
    } catch {
      return 'invalid_endpoint';
    }
  };

  const canResend = async (phone) => {
    const otpSettings = await getOtpSettings();
    const entry = otpStore.get(phone);
    if (!entry) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const currentTime = Date.now();
    const sinceCreated = currentTime - entry.createdAt;
    if (sinceCreated < otpSettings.resendCooldownMs) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((otpSettings.resendCooldownMs - sinceCreated) / 1000)
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  };

  const saveOtp = async (phone, code) => {
    const otpSettings = await getOtpSettings();
    const entry = {
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + otpSettings.expireSeconds * 1000,
      attempts: 0,
      blockedUntil: 0
    };

    const variants = getIranMobileVariants(phone);
    if (variants.length === 0) {
      otpStore.set(phone, entry);
      logger.log('[OTP] state_updated', { operation: 'store', keyVariantCount: 1, fallbackKey: true });
      return;
    }

    for (const variant of variants) {
      otpStore.set(variant, { ...entry });
    }
    logger.log('[OTP] state_updated', { operation: 'store', keyVariantCount: variants.length, fallbackKey: false });
  };

  const verifyOtp = async (phone, code) => {
    const otpSettings = await getOtpSettings();
    const otpExpireMs = otpSettings.expireSeconds * 1000;
    const variants = getIranMobileVariants(phone);
    const matchedKey = variants.find((variant) => otpStore.has(variant));
    const lookupKey = matchedKey || phone;
    logger.log('[OTP] state_lookup', { operation: 'verify', keyVariantCount: variants.length, found: Boolean(otpStore.get(lookupKey)) });
    const entry = otpStore.get(lookupKey);
    if (!entry) {
      return { valid: false, reason: 'not_found' };
    }

    const currentTime = Date.now();

    if (entry.blockedUntil && currentTime < entry.blockedUntil) {
      return {
        valid: false,
        reason: 'too_many_attempts',
        retryAfterSeconds: Math.ceil((entry.blockedUntil - currentTime) / 1000)
      };
    }

    if (currentTime > entry.expiresAt) {
      for (const variant of variants) {
        otpStore.delete(variant);
      }
      return { valid: false, reason: 'expired' };
    }

    const candidateCode = String(code || '').trim();
    const matchesDirect = entry.code === candidateCode;
    const matchesWithLeadingZero =
      candidateCode.length === entry.code.length + 1 &&
      candidateCode.startsWith('0') &&
      candidateCode.slice(1) === entry.code;
    const matchesBySuffix = candidateCode.length > entry.code.length && candidateCode.endsWith(entry.code);

    if (!(matchesDirect || matchesWithLeadingZero || matchesBySuffix)) {
      entry.attempts += 1;
      if (entry.attempts >= maxWrongAttempts) {
        entry.blockedUntil = currentTime + otpExpireMs;
        for (const variant of variants) {
          otpStore.set(variant, { ...entry });
        }
        return { valid: false, reason: 'too_many_attempts', retryAfterSeconds: Math.ceil(otpExpireMs / 1000) };
      }

      for (const variant of variants) {
        otpStore.set(variant, { ...entry });
      }
      return {
        valid: false,
        reason: 'invalid_code',
        remainingAttempts: Math.max(0, maxWrongAttempts - entry.attempts)
      };
    }

    for (const variant of variants) {
      otpStore.delete(variant);
    }
    return { valid: true };
  };

  const cleanupExpired = () => {
    const currentTime = Date.now();
    for (const [phone, entry] of otpStore.entries()) {
      if (currentTime > entry.expiresAt && (!entry.blockedUntil || currentTime > entry.blockedUntil)) {
        otpStore.delete(phone);
      }
    }
  };

  const sendPatternOtp = async (phone, code) => {
    const apiKey = getRequiredConfig('IPPANEL_API_KEY', ippanelApiKey);
    const patternCode = getRequiredConfig('IPPANEL_PATTERN_CODE', ippanelPatternCode);
    const fromNumber = getRequiredConfig('IPPANEL_SENDER', ippanelSender);
    const normalizedPhone = normalizeIranMobileToInternational(phone);
    const normalizedCode = String(code || '').trim();

    if (!normalizedCode) {
      throw new Error('OTP code is required');
    }

    if (otpDevMock) {
      logger.log(`[${now()}] [OTP_PROVIDER] send_result`, {
        provider: 'dev_mock',
        operation: 'pattern_otp',
        outcome: 'sent',
        httpStatus: 200
      });

      return {
        success: true,
        status: 200,
        data: { mocked: true },
        recipient: normalizedPhone
      };
    }

    const payload = {
      sending_type: 'pattern',
      from_number: fromNumber,
      code: patternCode,
      recipients: [`+${normalizedPhone}`],
      params: {
        code: normalizedCode
      }
    };

    const headers = {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };

    logger.log(`[${now()}] [OTP_PROVIDER] send_attempt`, {
      provider: 'ippanel',
      operation: 'pattern_otp',
      endpointHost: getEndpointHost()
    });

    try {
      const response = await ippanelClient.post(ippanelSendUrl, payload, { headers });

      logger.log(`[${now()}] [OTP_PROVIDER] send_result`, {
        provider: 'ippanel',
        operation: 'pattern_otp',
        outcome: 'sent',
        httpStatus: response.status
      });

      return {
        success: true,
        status: response.status,
        data: null
      };
    } catch (error) {
      const rawRetryAfter =
        typeof error.response?.headers?.get === 'function'
          ? error.response.headers.get('retry-after')
          : error.response?.headers?.['retry-after'];
      const retryAfterSeconds = Number.parseInt(String(rawRetryAfter || ''), 10);
      const status = Number.isInteger(error.response?.status) ? error.response.status : 0;
      const failure = classifyProviderFailure(status);
      logger.warn(`[${now()}] [OTP_PROVIDER] send_result`, {
        provider: 'ippanel',
        operation: 'pattern_otp',
        outcome: 'failed',
        upstreamStatus: status || null,
        category: failure.category,
        retryable: failure.retryable,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : null
      });

      return {
        success: false,
        error: failure.category,
        details: null,
        status: status || 500,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : undefined,
        retryable: failure.retryable
      };
    }
  };

  const sendOtp = async (phone) => {
    validateOtpConfig();
    const normalizedPhone = normalizeIranMobileToInternational(phone);

    const otpSettings = await getOtpSettings();
    const resendState = await canResend(normalizedPhone);
    if (!resendState.allowed) {
      return {
        success: false,
        statusCode: 429,
        body: {
          success: false,
          error: 'Please wait before requesting another OTP',
          retryAfterSeconds: resendState.retryAfterSeconds
        }
      };
    }

    const code = generateOtp();
    logger.log(`[${now()}] [OTP] request`, {
      operation: 'send',
      provider: 'ippanel'
    });

    const result = await sendPatternOtp(normalizedPhone, code);

    logger.log(`[${now()}] [OTP] result`, {
      outcome: result.success ? 'sent' : 'failed',
      providerStatus: result.status || null,
      category: result.error || null,
      retryable: result.retryable === true
    });

    if (!result.success) {
      return {
        success: false,
        statusCode: result.status || 500,
        body: {
          success: false,
          error: 'Failed to send OTP',
          details: result.details || result.error
        }
      };
    }

    await saveOtp(normalizedPhone, code);

    return {
      success: true,
      statusCode: 200,
      body: {
        success: true,
        message: 'OTP sent successfully',
        recipient: normalizedPhone,
        expiresInSeconds: otpSettings.expireSeconds
      }
    };
  };

  const verifyOtpRequest = async (phone, code) => {
    if (!code) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'OTP code is required'
        }
      };
    }

    const normalizedPhone = normalizeIranMobileToInternational(phone);
    const result = await verifyOtp(normalizedPhone, code);

    if (result.valid) {
      return {
        statusCode: 200,
        body: {
          success: true,
          message: 'OTP verified successfully',
          recipient: normalizedPhone
        }
      };
    }

    if (result.reason === 'expired') {
      return { statusCode: 410, body: { success: false, error: 'OTP has expired' } };
    }

    if (result.reason === 'not_found') {
      return { statusCode: 404, body: { success: false, error: 'No OTP found for this phone number' } };
    }

    if (result.reason === 'too_many_attempts') {
      return {
        statusCode: 429,
        body: {
          success: false,
          error: 'Too many wrong attempts',
          retryAfterSeconds: result.retryAfterSeconds
        }
      };
    }

    return {
      statusCode: 401,
      body: {
        success: false,
        error: 'Invalid OTP',
        remainingAttempts: result.remainingAttempts
      }
    };
  };

  const timer = typeof setTimer === 'function' ? setTimer(cleanupExpired, 60 * 1000) : null;
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    sendOtp,
    verifyOtpRequest,
    sendVerificationCode: sendPatternOtp,
    sendOTP: sendPatternOtp,
    sendPatternOtp,
    generateOtp,
    canResend,
    saveOtp,
    verifyOtp,
    cleanupExpired,
    getExpirySeconds: () => (Number.isFinite(Number(otpExpireSeconds)) ? Number(otpExpireSeconds) : 120)
  };
}

module.exports = { createSmsService };
