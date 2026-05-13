const OTP_EXPIRE_SECONDS = Number.parseInt(process.env.OTP_EXPIRE || '120', 10);
const OTP_EXPIRE_MS = (Number.isFinite(OTP_EXPIRE_SECONDS) ? OTP_EXPIRE_SECONDS : 120) * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_WRONG_ATTEMPTS = 5;

class OTPService {
  constructor() {
    /** @type {Map<string, {code: string, expiresAt: number, createdAt: number, attempts: number, blockedUntil: number}>} */
    this.otpStore = new Map();
  }

  generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
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
    this.otpStore.set(phone, {
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_EXPIRE_MS,
      attempts: 0,
      blockedUntil: 0
    });
  }

  verifyOtp(phone, code) {
    const entry = this.otpStore.get(phone);
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
      this.otpStore.delete(phone);
      return { valid: false, reason: 'expired' };
    }

    if (entry.code !== code) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_WRONG_ATTEMPTS) {
        entry.blockedUntil = now + OTP_EXPIRE_MS;
        this.otpStore.set(phone, entry);
        return { valid: false, reason: 'too_many_attempts', retryAfterSeconds: Math.ceil(OTP_EXPIRE_MS / 1000) };
      }

      this.otpStore.set(phone, entry);
      return {
        valid: false,
        reason: 'invalid_code',
        remainingAttempts: Math.max(0, MAX_WRONG_ATTEMPTS - entry.attempts)
      };
    }

    this.otpStore.delete(phone);
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
