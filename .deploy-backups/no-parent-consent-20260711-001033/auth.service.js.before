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
  signupTokenExpiresIn = '10m',
  settingsRepository,
  supervisedOtpRepository,
  eventsRepository,
  logger = console,
  now = () => new Date().toISOString()
}) {
  const getAgeValidation = async () => {
    if (!settingsRepository || typeof settingsRepository.getAll !== 'function') {
      return { min: 8 };
    }
    const settings = await settingsRepository.getAll();
    const min = Number(settings['auth.validation.age_min']);
    return {
      min: Number.isFinite(min) ? min : 8
    };
  };

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

  const createSignupToken = (phone, extraPayload = {}) => {
    if (!jwt || typeof jwt.sign !== 'function' || !jwtSecret) {
      return null;
    }

    return jwt.sign({ phone, type: 'signup_profile', ...extraPayload }, jwtSecret, { expiresIn: signupTokenExpiresIn });
  };

  const verifySignupToken = (token, phone) => {
    if (!jwt || typeof jwt.verify !== 'function' || !jwtSecret) {
      return null;
    }

    try {
      const payload = jwt.verify(String(token || ''), jwtSecret);
      return payload?.type === 'signup_profile' && payload?.phone === phone ? payload : null;
    } catch (_error) {
      return null;
    }
  };

  const buildFamilyPayload = (user, fallback = {}) => {
    const childId = user?.child_id || user?.user_id || fallback.userId || null;
    const guardianId = user?.guardian_id || fallback.guardianId || null;
    const guardianPhone = user?.guardian_phone || fallback.phone || user?.phone || null;

    return {
      child: childId
        ? {
            id: String(childId),
            name: user?.name || fallback.name || 'کاربر',
            age: Number(user?.age ?? fallback.age ?? 0),
            avatar: user?.avatar || null,
            grade: user?.grade || null,
            safetyLevel: user?.safety_level || 'standard'
          }
        : null,
      guardian: guardianId
        ? {
            id: String(guardianId),
            phone: guardianPhone
          }
        : guardianPhone
          ? {
              id: null,
              phone: guardianPhone
            }
          : null
    };
  };

  const generateOtp = () => String(Math.floor(10000 + Math.random() * 90000));

  const logSupervisedOtpEvent = async ({ userId, phone, result }) => {
    if (!eventsRepository || typeof eventsRepository.logEvent !== 'function' || !userId) return;
    try {
      await eventsRepository.logEvent(userId, 'supervised_otp_verified', 'auth', {
        method: 'supervised_otp',
        phone,
        result
      });
    } catch (error) {
      logger.warn?.('[AUTH] supervised OTP event logging failed', {
        userId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const completeVerifiedPhone = async ({ phone, mode, guestId, verifiedBy = 'sms_otp' }) => {
    const isSupervised = verifiedBy === 'supervised_otp';
    let existingUser = await authRepository.findUserByPhone(phone);
    if (existingUser?.isBanned) {
      return { statusCode: 403, body: { success: false, error: 'حساب شما مسدود شده است' } };
    }

    if (existingUser) {
      if (!existingUser.guardian_id && typeof authRepository.createUser === 'function') {
        await authRepository.createUser({
          id: existingUser.user_id,
          name: existingUser.name || 'کاربر',
          age: Number(existingUser.age || 0),
          phone
        });
        existingUser = (await authRepository.findUserByPhone(phone)) || existingUser;
      }

      let guestMigration = null;
      if (guestsRepository && typeof guestsRepository.migrateGuestToUser === 'function' && guestId) {
        guestMigration = await guestsRepository.migrateGuestToUser({
          guestId,
          userId: String(existingUser.user_id)
        });
      }

      if (isSupervised) {
        await supervisedOtpRepository?.recordUsage?.({
          phone,
          userId: String(existingUser.user_id),
          result: 'login_existing'
        });
        await logSupervisedOtpEvent({
          userId: String(existingUser.user_id),
          phone,
          result: 'login_existing'
        });
      }

      const token = createToken({
        sub: String(existingUser.user_id),
        phone,
        type: 'user',
        child_id: String(existingUser.child_id || existingUser.user_id),
        ...(existingUser.guardian_id ? { guardian_id: String(existingUser.guardian_id) } : {})
      });
      const family = buildFamilyPayload(existingUser, { phone });

      return {
        statusCode: 200,
        body: {
          success: true,
          isNewUser: false,
          requiresProfile: false,
          userId: existingUser.user_id,
          profile: {
            name: existingUser.name || 'کاربر',
            age: Number(existingUser.age || 0),
            phone
          },
          ...family,
          ...(guestMigration ? { guestMigration } : {}),
          ...(token ? { token } : {})
        }
      };
    }

    if (isSupervised) {
      await supervisedOtpRepository?.recordUsage?.({
        phone,
        result: 'signup_new'
      });
    }

    logger.log?.('[OTP] verification successful', {
      phone,
      mode,
      verifiedBy,
      verifiedAt: now()
    });
    return {
      statusCode: 200,
      body: {
        success: true,
        isNewUser: true,
        requiresProfile: true,
        signupToken: createSignupToken(phone, isSupervised ? { verifiedBy: 'supervised_otp' } : {})
      }
    };
  };

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

    const requestState =
      typeof authRepository.checkAndRecordOtpRequest === 'function'
        ? await authRepository.checkAndRecordOtpRequest(phone)
        : { allowed: true };
    if (!requestState.allowed) {
      return {
        statusCode: 429,
        body: {
          success: false,
          error: 'برای این شماره بیش از حد کد درخواست شده است. کمی بعد دوباره تلاش کنید.',
          retryAfter: requestState.retryAfterSeconds
        }
      };
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
      mode: mode || 'phone_otp',
      expiresIn: saved.expiresIn,
      createdAt: now()
    });

    return { statusCode: 200, body: { success: true, expiresIn: saved.expiresIn } };
  };

  const verifyCode = async ({ phone: rawPhone, code: rawCode, mode, guestId }) => {
    const phone = normalizeIranMobileToLocal(rawPhone);
    const code = normalizeOtpCode(rawCode);
    const canCheckSupervisedOtp = (reason) => ['invalid_code', 'expired'].includes(reason);

    logger.log?.('[OTP] verify-code request', {
      phone,
      mode,
      rawCodeLength: typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode).length : 0,
      digitOnlyCodeLength: code.length
    });

    if (!isValidIranMobileLocal(phone) || !/^[0-9]{4,6}$/.test(code)) {
      logger.warn?.('[OTP] verify-code validation failed', {
        phoneValid: isValidIranMobileLocal(phone),
        codeRegexPassed: /^[0-9]{4,6}$/.test(code)
      });
      return { statusCode: 400, body: { success: false, error: 'کد منقضی شده یا نامعتبر است' } };
    }

    const verifyResult = await authRepository.verifyOtp(phone, code);
    if (!verifyResult.valid) {
      const supervisedOtpAvailable =
        supervisedOtpRepository && typeof supervisedOtpRepository.verifyAndConsume === 'function';
      const shouldCheckSupervisedOtp = canCheckSupervisedOtp(verifyResult.reason) && supervisedOtpAvailable;

      if (shouldCheckSupervisedOtp) {
        const supervisedResult = await supervisedOtpRepository.verifyAndConsume(code);
        logger.log?.('[OTP] supervised fallback debug', {
          supervisedOtpEnabled: Boolean(supervisedResult.debug?.supervisedOtpEnabled),
          hasCodeHash: Boolean(supervisedResult.debug?.hasCodeHash),
          isExpired: Boolean(supervisedResult.debug?.isExpired),
          maxUsesReached: Boolean(supervisedResult.debug?.maxUsesReached),
          bcryptMatched: Boolean(supervisedResult.debug?.bcryptMatched),
          fallbackChecked: true
        });
        if (supervisedResult.valid) {
          logger.log?.('[OTP] supervised verification accepted', {
            phone,
            mode,
            verifiedAt: now()
          });
          return completeVerifiedPhone({ phone, mode, guestId, verifiedBy: 'supervised_otp' });
        }
      } else {
        logger.log?.('[OTP] supervised fallback debug', {
          supervisedOtpEnabled: false,
          hasCodeHash: false,
          isExpired: false,
          maxUsesReached: false,
          bcryptMatched: false,
          fallbackChecked: false
        });
      }

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

    return completeVerifiedPhone({ phone, mode, guestId, verifiedBy: 'sms_otp' });
  };

  const registerProfile = async ({ name, age, phone: rawPhone, id, mode, guestId, signupToken, guardianConsent }) => {
    const inputName = typeof name === 'string' ? name.trim() : '';
    const rawName = inputName || 'کاربر';
    const phone = normalizeIranMobileToLocal(rawPhone);
    const rawAge = normalizeAge(age);

    if (!isValidIranMobileLocal(phone)) {
      return { statusCode: 400, body: { error: 'شماره موبایل معتبر نیست.' } };
    }

    if (mode === 'login') {
      return { statusCode: 400, body: { error: 'برای ورود، کد تایید را ارسال کنید.' } };
    }

    const signupPayload = mode !== 'login' ? verifySignupToken(signupToken, phone) : null;
    if (mode !== 'login' && !signupPayload) {
      return { statusCode: 401, body: { error: 'تأیید شماره منقضی شده است. دوباره کد بگیرید.' } };
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
    if (mode !== 'login' && existingUser) {
      return { statusCode: 409, body: { error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' } };
    }

    if (mode !== 'login') {
      if (guardianConsent !== true) {
        return {
          statusCode: 400,
          body: { error: 'برای ساخت حساب کودک، تایید والد یا قیم لازم است.' }
        };
      }
      if (!Number.isFinite(rawAge)) {
        return { statusCode: 400, body: { error: 'سن معتبر نیست.' } };
      }
      const ageValidation = await getAgeValidation();
      if (rawAge < ageValidation.min) {
        return {
          statusCode: 400,
          body: { error: `سن باید حداقل ${ageValidation.min} سال باشد.` }
        };
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
            phone,
            guardianConsent: true,
            guardianConsentVersion: '2026-07-02'
          };

    const userId = await authRepository.createUser(payloadProfile);
    const savedUser = await authRepository.findUserByPhone(phone);
    if (signupPayload?.verifiedBy === 'supervised_otp') {
      await logSupervisedOtpEvent({
        userId: String(userId),
        phone,
        result: 'signup_new'
      });
    }

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
      type: 'user',
      child_id: String(savedUser?.child_id || userId),
      ...(savedUser?.guardian_id ? { guardian_id: String(savedUser.guardian_id) } : {})
    });
    const family = buildFamilyPayload(savedUser, {
      userId,
      phone,
      name: payloadProfile.name,
      age: payloadProfile.age
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
        ...family,
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
