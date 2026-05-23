const { getIranMobileVariants } = require('../shared/validators/phone.validator');

const OTP_EXPIRE_SECONDS = Number.parseInt(process.env.OTP_EXPIRE || '120', 10);
const OTP_EXPIRE_MS = (Number.isFinite(OTP_EXPIRE_SECONDS) ? OTP_EXPIRE_SECONDS : 120) * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_WRONG_ATTEMPTS = 5;

class OTPService {
  constructor() {
    /** @type {Map<string, {code: string, expiresAt: number, createdAt: number, attempts: number, blockedUntil: number}>} */
    this.otpStore = new Map();
  }

  getPhoneVariants(phone) {
    return getIranMobileVariants(phone);
  }

  generateOtp() {
    // IPPanel pattern sample uses a 5-digit token; keep this aligned.
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  canResend(phone) {
    const entry = this.otpStore.get(phone);
    if (!entry) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    const sinceCreated = now - entry.createdAt;
    if (sinceCreated < RESEND_COOLDOWN_MS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceCreated) / 1000)
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  saveOtp(phone, code) {
    const entry = {
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_EXPIRE_MS,
      attempts: 0,
      blockedUntil: 0
    };

    const variants = this.getPhoneVariants(phone);
    if (variants.length === 0) {
      this.otpStore.set(phone, entry);
      console.log('[OTPService] saveOtp (fallback key)', { key: phone, codeLength: String(code).length });
      return;
    }

    for (const variant of variants) {
      this.otpStore.set(variant, { ...entry });
    }
    console.log('[OTPService] saveOtp keys', { keys: variants, codeLength: String(code).length });
  }

  verifyOtp(phone, code) {
    const variants = this.getPhoneVariants(phone);
    const matchedKey = variants.find((variant) => this.otpStore.has(variant));
    const lookupKey = matchedKey || phone;
    console.log('[OTPService] verifyOtp lookup', { phone, variants, lookupKey, found: Boolean(this.otpStore.get(lookupKey)) });
    const entry = this.otpStore.get(lookupKey);
    if (!entry) {
      return { valid: false, reason: 'not_found' };
    }

    const now = Date.now();

    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        valid: false,
        reason: 'too_many_attempts',
        retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000)
      };
    }

    if (now > entry.expiresAt) {
      for (const variant of variants) {
        this.otpStore.delete(variant);
      }
      return { valid: false, reason: 'expired' };
    }

    const candidateCode = String(code || '').trim();
    const matchesDirect = entry.code === candidateCode;
    const matchesWithLeadingZero = candidateCode.length === entry.code.length + 1
      && candidateCode.startsWith('0')
      && candidateCode.slice(1) === entry.code;
    const matchesBySuffix = candidateCode.length > entry.code.length && candidateCode.endsWith(entry.code);

    if (!(matchesDirect || matchesWithLeadingZero || matchesBySuffix)) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_WRONG_ATTEMPTS) {
        entry.blockedUntil = now + OTP_EXPIRE_MS;
        for (const variant of variants) {
          this.otpStore.set(variant, { ...entry });
        }
        return { valid: false, reason: 'too_many_attempts', retryAfterSeconds: Math.ceil(OTP_EXPIRE_MS / 1000) };
      }

      for (const variant of variants) {
        this.otpStore.set(variant, { ...entry });
      }
      return {
        valid: false,
        reason: 'invalid_code',
        remainingAttempts: Math.max(0, MAX_WRONG_ATTEMPTS - entry.attempts)
      };
    }

    for (const variant of variants) {
      this.otpStore.delete(variant);
    }
    return { valid: true };
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [phone, entry] of this.otpStore.entries()) {
      if (now > entry.expiresAt && (!entry.blockedUntil || now > entry.blockedUntil)) {
        this.otpStore.delete(phone);
      }
    }
  }

  getExpirySeconds() {
    return Math.floor(OTP_EXPIRE_MS / 1000);
  }
}

const otpService = new OTPService();
setInterval(() => otpService.cleanupExpired(), 60 * 1000);

module.exports = otpService;
