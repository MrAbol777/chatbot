const { normalizeGuestId } = require('../../repositories/GuestRepository');

const GUEST_COOKIE_NAME = 'danoa_guest_id';

function createAuthController({ authService, errorsRepository, logger = console }) {
  const sendVerificationCode = async (req, res) => {
    try {
      const result = await authService.sendVerificationCode({
        phone: req.body?.phone,
        mode: typeof req.body?.mode === 'string' ? req.body.mode.trim() : ''
      });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      logger.error?.('[OTP] send-verification-code failed', {
        message: error instanceof Error ? error.message : 'unknown',
        status: error?.response?.status || null,
        responseBody: error?.response?.data || null
      });
      await errorsRepository.logError('verification_code_failed', '/api/send-verification-code', 500, error instanceof Error ? error.message : 'unknown');
      return res.status(500).json({ error: 'ارسال کد با خطا مواجه شد.' });
    }
  };

  const phoneStatus = async (req, res) => {
    try {
      const result = await authService.checkPhoneStatus({
        phone: req.body?.phone,
        mode: typeof req.body?.mode === 'string' ? req.body.mode.trim() : ''
      });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      await errorsRepository.logError('phone_status_failed', '/api/auth/phone-status', 500, error instanceof Error ? error.message : 'unknown');
      return res.status(500).json({ error: 'بررسی شماره موبایل با خطا مواجه شد.' });
    }
  };

  const verifyCode = async (req, res) => {
    try {
      const result = await authService.verifyCode({
        phone: req.body?.phone,
        code: req.body?.code,
        mode: typeof req.body?.mode === 'string' ? req.body.mode.trim() : ''
      });
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      await errorsRepository.logError('verify_code_failed', '/api/verify-code', 500, error instanceof Error ? error.message : 'unknown');
      return res.status(500).json({ success: false, error: 'تأیید کد با خطا مواجه شد.' });
    }
  };

  const registerProfile = async (req, res) => {
    try {
      const cookieGuestId = normalizeGuestId(req.cookies?.[GUEST_COOKIE_NAME]);
      const bodyGuestId = normalizeGuestId(req.body?.guestId);
      const result = await authService.registerProfile({
        ...(req.body || {}),
        guestId: cookieGuestId || bodyGuestId || ''
      });
      if (result.body?.success && (cookieGuestId || bodyGuestId)) {
        res.clearCookie(GUEST_COOKIE_NAME, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production'
        });
      }
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      const details = error instanceof Error ? error.message : 'unknown';
      if (error && typeof error === 'object' && error.code === 'PHONE_ALREADY_IN_USE') {
        return res.status(409).json({ error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' });
      }
      await errorsRepository.logError('register_profile_failed', '/api/register-profile', 500, details);
      logger.log?.('REGISTER_PROFILE', 'failed', { details });
      return res.status(500).json({ error: 'ثبت پروفایل با خطا مواجه شد.' });
    }
  };

  return {
    sendVerificationCode,
    phoneStatus,
    verifyCode,
    registerProfile
  };
}

module.exports = { createAuthController };
