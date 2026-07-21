const express = require('express');
const otpService = require('../services/otp.service');
const patternSmsService = require('../services/sms.service');
const { normalizePhone } = patternSmsService;

const router = express.Router();

const now = () => new Date().toISOString();

const validateOtpEnv = () => {
  const required = ['IPPANEL_API_KEY', 'IPPANEL_PATTERN_CODE', 'IPPANEL_SENDER'];
  const missing = required.filter((key) => {
    const value = process.env[key];
    return !value || !String(value).trim();
  });

  if (missing.length > 0) {
    const error = new Error(`Missing required env vars: ${missing.join(', ')}`);
    error.statusCode = 500;
    throw error;
  }
};

router.post('/send-otp', async (req, res) => {
  try {
    validateOtpEnv();

    const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
    const normalizedPhone = normalizePhone(phone);

    const resendState = otpService.canResend(normalizedPhone);
    if (!resendState.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Please wait before requesting another OTP',
        retryAfterSeconds: resendState.retryAfterSeconds
      });
    }

    const code = otpService.generateOtp();

    console.log(`[${now()}] [OTP] Before send`, {
      endpoint: '/api/sms/send-otp',
      recipient: normalizedPhone
    });

    const result = await patternSmsService.sendVerificationCode(normalizedPhone, code);

    console.log(`[${now()}] [OTP] After provider response`, {
      success: result.success,
      status: result.status,
      recipient: normalizedPhone,
      data: result.data || null,
      details: result.details || null
    });

    if (!result.success) {
      return res.status(result.status || 500).json({
        success: false,
        error: 'Failed to send OTP',
        details: result.details || result.error
      });
    }

    otpService.saveOtp(normalizedPhone, code);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      recipient: normalizedPhone,
      expiresInSeconds: otpService.getExpirySeconds()
    });
  } catch (error) {
    console.error(`[${now()}] [OTP] Error in /send-otp`, {
      message: error.message,
      responseData: error.response?.data
    });

    return res.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
    const code = typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number'
      ? String(req.body.otp).trim()
      : '';

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'OTP code is required'
      });
    }

    const normalizedPhone = normalizePhone(phone);
    const result = otpService.verifyOtp(normalizedPhone, code);

    if (result.valid) {
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        recipient: normalizedPhone
      });
    }

    if (result.reason === 'expired') {
      return res.status(410).json({ success: false, error: 'OTP has expired' });
    }

    if (result.reason === 'not_found') {
      return res.status(404).json({ success: false, error: 'No OTP found for this phone number' });
    }

    if (result.reason === 'too_many_attempts') {
      return res.status(429).json({
        success: false,
        error: 'Too many wrong attempts',
        retryAfterSeconds: result.retryAfterSeconds
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid OTP',
      remainingAttempts: result.remainingAttempts
    });
  } catch (error) {
    console.error(`[${now()}] [OTP] Error in /verify-otp`, {
      message: error.message,
      responseData: error.response?.data
    });

    return res.status(400).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

router.post('/test-otp', async (req, res) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
    if (!phone.trim()) {
      return res.status(400).json({
        success: false,
        error: 'phone is required in request body'
      });
    }

    req.body.phone = phone;
    return router.handle({ ...req, url: '/send-otp', method: 'POST' }, res, () => {});
  } catch (error) {
    console.error(`[${now()}] [OTP] Error in /test-otp`, {
      message: error.message,
      responseData: error.response?.data
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

module.exports = router;
