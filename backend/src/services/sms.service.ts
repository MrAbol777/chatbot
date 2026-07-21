import axios from 'axios';

const IPPANEL_PATTERN_URL = 'https://edge.ippanel.com/v1/messages/patterns/send';

export class PatternSMSService {
  private apiKey: string;
  private patternCode: string;
  private sender: string;

  constructor() {
    this.apiKey = typeof process.env.IPPANEL_API_KEY === 'string' ? process.env.IPPANEL_API_KEY.trim() : '';
    this.patternCode = typeof process.env.IPPANEL_PATTERN_CODE === 'string' ? process.env.IPPANEL_PATTERN_CODE.trim() : '';
    const sender = typeof process.env.IPPANEL_SENDER === 'string' ? process.env.IPPANEL_SENDER.trim() : '3000505';
    this.sender = sender.startsWith('+') ? sender : `+98${sender.replace(/^0+/, '')}`;
  }

  private toInternationalPhone(phone: string): string {
    if (phone.startsWith('+98')) return phone;
    if (phone.startsWith('98')) return `+${phone}`;
    if (phone.startsWith('09')) return `+98${phone.slice(1)}`;
    return phone;
  }

  async sendVerificationCode(phone: string, otpCode: string): Promise<unknown> {
    if (!this.apiKey || !this.patternCode || !this.sender) {
      throw new Error('IPPANEL env vars are not fully configured');
    }

    const payload = {
      code: this.patternCode,
      sender: this.sender,
      recipient: this.toInternationalPhone(phone),
      variable: {
        verification_code: otpCode
      }
    };

    const response = await axios.post(IPPANEL_PATTERN_URL, payload, {
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    return response.data;
  }
}

export const patternSMSService = new PatternSMSService();
