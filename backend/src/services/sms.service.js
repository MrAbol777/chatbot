const axios = require('axios');

const IPPANEL_PATTERN_SEND_URL = 'https://edge.ippanel.com/v1/messages/patterns/send';

const now = () => new Date().toISOString();

const normalizePhone = (phone) => {
  if (typeof phone !== 'string') {
    throw new Error('phone must be a string');
  }

  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('09') && digits.length === 11) {
    return `98${digits.slice(1)}`;
  }

  if (digits.startsWith('989') && digits.length === 12) {
    return digits;
  }

  throw new Error('Invalid Iranian mobile number. Accepted formats: 09XXXXXXXXX, 989XXXXXXXXX, +989XXXXXXXXX');
};

const getRequiredEnv = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return String(value).trim();
};

class PatternSmsService {
  constructor() {
    this.http = axios.create({
      baseURL: 'https://edge.ippanel.com',
      timeout: Number(process.env.IPPANEL_TIMEOUT_MS || 15000)
    });
  }

  sendVerificationCode(phone, code) {
    return this.sendPatternOtp(phone, code);
  }

  sendOTP(phone, code) {
    return this.sendVerificationCode(phone, code);
  }

  async sendPatternOtp(phone, code) {
    const apiKey = getRequiredEnv('IPPANEL_API_KEY');
    const patternCode = getRequiredEnv('IPPANEL_PATTERN_CODE');
    const originator = getRequiredEnv('IPPANEL_SENDER');
    const normalizedPhone = normalizePhone(phone);
    const normalizedCode = String(code || '').trim();

    if (!normalizedCode) {
      throw new Error('OTP code is required');
    }

    const payload = {
      pattern_code: patternCode,
      originator,
      recipient: normalizedPhone,
      values: {
        verification_code: normalizedCode
      }
    };

    console.log(`[${now()}] [IPPanel] Before send pattern OTP`, {
      endpoint: IPPANEL_PATTERN_SEND_URL,
      payload: {
        ...payload,
        recipient: normalizedPhone
      }
    });

    try {
      const response = await this.http.post('/v1/messages/patterns/send', payload, {
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      });

      console.log(`[${now()}] [IPPanel] After send pattern OTP response`, {
        status: response.status,
        data: response.data
      });

      return {
        success: true,
        status: response.status,
        data: response.data,
        recipient: normalizedPhone
      };
    } catch (error) {
      console.error(`[${now()}] [IPPanel] Error while sending pattern OTP`, {
        message: error.message,
        responseData: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
        status: error.response?.status || 500,
        recipient: normalizedPhone
      };
    }
  }

  async sendCustomOTP(phone, code, template = 'کد تایید: {otp}') {
    const otp = String(code || '').trim();
    if (!otp) {
      throw new Error('OTP code is required');
    }

    return this.sendPatternOtp(phone, otp, template);
  }

  async sendPanelLoginOTP() {
    throw new Error('sendPanelLoginOTP is not supported in pattern OTP flow.');
  }

  async sendSMS() {
    throw new Error('sendSMS is not supported in pattern OTP flow. Use sendOTP/sendPatternOtp.');
  }

  async sendBulkSMS() {
    throw new Error('sendBulkSMS is not supported in pattern OTP flow.');
  }
}

const patternSmsService = new PatternSmsService();

module.exports = patternSmsService;
module.exports.patternSmsService = patternSmsService;
module.exports.sendVerificationCode = patternSmsService.sendVerificationCode.bind(patternSmsService);
module.exports.sendOTP = patternSmsService.sendOTP.bind(patternSmsService);
module.exports.sendPatternOtp = patternSmsService.sendPatternOtp.bind(patternSmsService);
module.exports.normalizePhone = normalizePhone;
module.exports.getRequiredEnv = getRequiredEnv;
