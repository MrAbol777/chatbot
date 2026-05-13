const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

class SMSService {
  constructor() {
    this.baseURL = 'https://edge.ippanel.com/v1';
    this.apiKey = process.env.IPPANEL_API_KEY;
    this.sender = process.env.IPPANEL_SENDER;

    if (!this.apiKey) {
      console.warn('[SMSService] Warning: IPPANEL_API_KEY is not set in environment variables');
    }

    if (!this.sender) {
      console.warn('[SMSService] Warning: IPPANEL_SENDER is not set in environment variables');
    }
  }

  generateOTP(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }

  async sendSMS(phone, message) {
    try {
      if (!this.apiKey) {
        throw new Error('IPPANEL_API_KEY is not configured');
      }

      const phoneNumbers = Array.isArray(phone) ? phone : [phone];
      for (const num of phoneNumbers) {
        if (!num || typeof num !== 'string') {
          throw new Error(`Invalid phone number: ${num}`);
        }
      }

      const payload = {
        ...(this.sender ? { from: this.sender } : {}),
        to: phoneNumbers,
        text: message
      };
      const url = `${this.baseURL}/sms/send`;

      console.log('[SMSService] Sending SMS:', {
        to: phoneNumbers,
        messageLength: message.length,
        timestamp: new Date().toISOString()
      });

      const response = await axios.post(
        url,
        payload,
        {
          headers: {
            'Authorization': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log('[SMSService] SMS sent successfully:', {
        status: response.status,
        data: response.data
      });

      return {
        success: true,
        data: response.data,
        status: response.status
      };

    } catch (error) {
      console.error('[SMSService] Error sending SMS:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
        status: error.response?.status || 500
      };
    }
  }

  async sendOTP(phone, otpLength = 6) {
    try {
      const otp = this.generateOTP(otpLength);
      const message = `کد تایید شما: ${otp}\n\nاین کد به مدت 5 دقیقه معتبر است.`;

      console.log('[SMSService] Sending OTP:', {
        phone,
        otpLength,
        timestamp: new Date().toISOString()
      });

      const result = await this.sendSMS(phone, message);

      if (result.success) {
        return {
          success: true,
          otp,
          message: 'OTP sent successfully',
          data: result.data
        };
      } else {
        return {
          success: false,
          error: result.error,
          details: result.details
        };
      }

    } catch (error) {
      console.error('[SMSService] Error in sendOTP:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendPanelLoginOTP(token) {
    try {
      if (!token || typeof token !== 'string') {
        throw new Error('token is required');
      }

      const payload = { token: token.trim() };

      console.log('[SMSService] Requesting IPPanel login OTP SMS', {
        timestamp: new Date().toISOString()
      });

      const response = await axios.post(
        `${this.baseURL}/api/acl/auth/send_sms_otp`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log('[SMSService] IPPanel login OTP response:', {
        status: response.status,
        data: response.data
      });

      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error('[SMSService] Error in sendPanelLoginOTP:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
        status: error.response?.status || 500
      };
    }
  }

  async sendCustomOTP(phone, otp, template = 'کد تایید: {otp}') {
    try {
      const message = template.replace('{otp}', otp);
      return await this.sendSMS(phone, message);
    } catch (error) {
      console.error('[SMSService] Error in sendCustomOTP:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendBulkSMS(phones, message) {
    try {
      if (!Array.isArray(phones) || phones.length === 0) {
        throw new Error('phones must be a non-empty array');
      }

      console.log('[SMSService] Sending bulk SMS:', {
        recipientCount: phones.length,
        timestamp: new Date().toISOString()
      });

      return await this.sendSMS(phones, message);

    } catch (error) {
      console.error('[SMSService] Error in sendBulkSMS:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new SMSService();