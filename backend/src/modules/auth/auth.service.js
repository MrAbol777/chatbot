const {
  normalizeIranMobileToLocal,
  isValidIranMobileLocal,
  normalizeOtpCode
} = require('../../shared/validators/phone.validator');

function createAuthService({
  authRepository,
  guestsRepository,
  smsService,
  jwt,
  jwtSecret,
  tokenExpiresIn = '30d',
  logger = console,
  now = () => new Date().toISOString()
}) {
  const normalizeLocalizedDigits = (value) =>
    String(value ?? '')
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));

  const normalizeAge = (value) => {
    const normalized = normalizeLocalizedDigits(value).trim();
    if (!/^[0-9]+$/.test(normalized)) {
      return Number.NaN;
    }
    return Number(normalized);
  };

  const createToken = (payload) => {
    if (!jwt || typeof jwt.sign !== 'function' || !jwtSecret) {
      return null;
    }

    return jwt.sign(payload, jwtSecret, { expiresIn: tokenExpiresIn });
  };

  const generateOtp = () => String(Math.floor(10000 + Math.random() * 90000));

  const checkPhoneStatus = async ({ phone: rawPhone, mode }) => {
    const phone = normalizeIranMobileToLocal(rawPhone);
    if (!isValidIranMobileLocal(phone)) {
      return { statusCode: 400, body: { error: 'شماره موبایل معتبر نیست.' } };
    }

    const user = await authRepository.findUserByPhone(phone);
    if (user?.isBanned) {
      return { statusCode: 403, body: { error: 'حساب شما مسدود شده است' } };
    }

    const exists = Boolean(user);
    const recommendedMode = exists ? 'login' : 'signup';
    const shouldRedirect = mode === 'signup' ? exists : mode === 'login' ? !exists : false;

    return {
      statusCode: 200,
      body: {
        success: true,
        exists,
        recommendedMode,
        redirectTo: shouldRedirect ? recommendedMode : null
      }
    };
  };

  const sendVerificationCode = async ({ phone: rawPhone, mode }) => {
    const phone = normalizeIranMobileToLocal(rawPhone);
    if (!isValidIranMobileLocal(phone)) {
      return { statusCode: 400, body: { error: 'شماره موبایل معتبر نیست.' } };
    }

    const phoneExists = Boolean(await authRepository.findUserByPhone(phone));
    if (mode === 'signup' && phoneExists) {
      return { statusCode: 409, body: { error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login', phoneExists } };
    }

    if (mode === 'login' && !phoneExists) {
      return { statusCode: 404, body: { error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup', phoneExists } };
    }

    const code = typeof smsService.generateOtp === 'function' ? smsService.generateOtp() : generateOtp();
    logger.log?.('[OTP] code generated', {
      phone,
      codeLength: String(code).length,
      createdAt: now()
    });

    const smsResult = await smsService.sendVerificationCode(phone, code);
    if (!smsResult?.success) {
      return { statusCode: smsResult?.status || 500, body: { error: 'ارسال کد با خطا مواجه شد.' } };
    }

    const saved = await authRepository.saveOtp(phone, code);

    logger.log?.('[OTP] verification code created', {
      phone,
      mode,
      expiresIn: saved.expiresIn,
      createdAt: now()
    });

    return { statusCode: 200, body: { success: true, expiresIn: saved.expiresIn } };
  };

  const verifyCode = async ({ phone: rawPhone, code: rawCode, mode }) => {
    const phone = normalizeIranMobileToLocal(rawPhone);
    const code = normalizeOtpCode(rawCode);

    logger.log?.('[OTP] verify-code request', {
      phone,
      mode,
      rawCodeLength: typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode).length : 0,
      digitOnlyCodeLength: code.length
    });

    if (!isValidIranMobileLocal(phone) || !/^[0-9]{5,6}$/.test(code)) {
      logger.warn?.('[OTP] verify-code validation failed', {
        phoneValid: isValidIranMobileLocal(phone),
        codeRegexPassed: /^[0-9]{5,6}$/.test(code)
      });
      return { statusCode: 400, body: { success: false, error: 'کد منقضی شده یا نامعتبر است' } };
    }

    const verifyResult = await authRepository.verifyOtp(phone, code);
    if (!verifyResult.valid) {
      logger.warn?.('[OTP] verify-code failed', {
        phone,
        reason: verifyResult.reason,
        remainingAttempts: verifyResult.remainingAttempts || null,
        retryAfterSeconds: verifyResult.retryAfterSeconds || null
      });

      if (verifyResult.reason === 'too_many_attempts') {
        return {
          statusCode: 429,
          body: {
            success: false,
            error: 'تعداد تلاش ناموفق بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
            retryAfter: verifyResult.retryAfterSeconds
          }
        };
      }
      if (verifyResult.reason === 'invalid_code') {
        return {
          statusCode: 400,
          body: {
            success: false,
            error: 'کد نادرست است',
            remainingAttempts: verifyResult.remainingAttempts
          }
        };
      }
      if (verifyResult.reason === 'expired') {
        return { statusCode: 410, body: { success: false, error: 'کد منقضی شده است. دوباره درخواست کد بدهید.' } };
      }
      if (verifyResult.reason === 'not_found') {
        return { statusCode: 404, body: { success: false, error: 'کدی برای این شماره پیدا نشد. دوباره درخواست کد بدهید.' } };
      }
      return { statusCode: 400, body: { success: false, error: 'کد منقضی شده یا نامعتبر است' } };
    }

    const phoneExists = Boolean(await authRepository.findUserByPhone(phone));
    if (mode === 'signup' && phoneExists) {
      return { statusCode: 409, body: { success: false, error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' } };
    }
    if (mode === 'login' && !phoneExists) {
      return { statusCode: 404, body: { success: false, error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup' } };
    }

    logger.log?.('[OTP] verification successful', {
      phone,
      mode,
      verifiedAt: now()
    });
    return { statusCode: 200, body: { success: true } };
  };

  const registerProfile = async ({ name, age, phone: rawPhone, id, mode, guestId }) => {
    const inputName = typeof name === 'string' ? name.trim() : '';
    const rawName = inputName || 'کاربر';
    const phone = normalizeIranMobileToLocal(rawPhone);
    const rawAge = normalizeAge(age);

    if (!isValidIranMobileLocal(phone)) {
      return { statusCode: 400, body: { error: 'شماره موبایل معتبر نیست.' } };
    }

    const existingUser = await authRepository.findUserByPhone(phone);

    logger.log?.('[AUTH] register-profile request', {
      phone,
      mode,
      hasInputName: Boolean(inputName),
      resolvedName: rawName
    });

    if (existingUser?.isBanned) {
      return { statusCode: 403, body: { error: 'حساب شما مسدود شده است' } };
    }
    if (mode === 'signup' && existingUser) {
      return { statusCode: 409, body: { error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' } };
    }
    if (mode === 'login' && !existingUser) {
      return { statusCode: 404, body: { error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup' } };
    }

    if (mode !== 'login') {
      if (!Number.isFinite(rawAge)) {
        return { statusCode: 400, body: { error: 'سن معتبر نیست.' } };
      }
    }

    const payloadProfile =
      mode === 'login' && existingUser
        ? {
            id: existingUser.user_id,
            name: existingUser.name,
            age: existingUser.age,
            phone
          }
        : {
            name: rawName,
            age: rawAge,
            phone
          };

    const userId = await authRepository.createUser(payloadProfile);
    let guestMigration = null;
    if (guestsRepository && typeof guestsRepository.migrateGuestToUser === 'function' && guestId) {
      guestMigration = await guestsRepository.migrateGuestToUser({
        guestId,
        userId: String(userId)
      });
    }

    const token = createToken({
      sub: String(userId),
      phone,
      type: 'user'
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        userId,
        profile: {
          name: payloadProfile.name,
          age: Number(payloadProfile.age),
          phone
        },
        ...(guestMigration ? { guestMigration } : {}),
        ...(token ? { token } : {})
      }
    };
  };

  return {
    checkPhoneStatus,
    sendVerificationCode,
    verifyCode,
    registerProfile,
    createToken
  };
}

module.exports = { createAuthService };
