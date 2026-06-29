function createSmsController({ smsService, logger = console, now = () => new Date().toISOString() }) {
  const sendOtp = async (req, res) => {
    try {
      const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
      const result = await smsService.sendOtp(phone);
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      logger.error(`[${now()}] [OTP] Error in /send-otp`, {
        message: error.message,
        responseData: error.response?.data
      });

      return res.status(error.statusCode || 400).json({
        success: false,
        error: error.message,
        details: error.response?.data || null
      });
    }
  };

  const verifyOtp = async (req, res) => {
    try {
      const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
      const code =
        typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number'
          ? String(req.body.otp).trim()
          : '';

      const result = await smsService.verifyOtpRequest(phone, code);
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      logger.error(`[${now()}] [OTP] Error in /verify-otp`, {
        message: error.message,
        responseData: error.response?.data
      });

      return res.status(400).json({
        success: false,
        error: error.message,
        details: error.response?.data || null
      });
    }
  };

  const testOtp = async (req, res) => {
    try {
      const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
      if (!phone.trim()) {
        return res.status(400).json({
          success: false,
          error: 'phone is required in request body'
        });
      }

      const result = await smsService.sendOtp(phone);
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      logger.error(`[${now()}] [OTP] Error in /test-otp`, {
        message: error.message,
        responseData: error.response?.data
      });

      return res.status(500).json({
        success: false,
        error: error.message,
        details: error.response?.data || null
      });
    }
  };

  return {
    sendOtp,
    verifyOtp,
    testOtp
  };
}

module.exports = { createSmsController };
