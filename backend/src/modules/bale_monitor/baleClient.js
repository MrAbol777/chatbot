const axios = require('axios');

class BaleClient {
  constructor(token, timeoutMs = 10000, retries = 2) {
    this.baseUrl = `https://tapi.bale.ai/bot${token}`;
    this.timeoutMs = timeoutMs;
    this.retries = Math.max(1, retries);
  }

  async sendMessage(chatId, text) {
    const url = `${this.baseUrl}/sendMessage`;
    const payload = { chat_id: chatId, text };

    let lastErr;
    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      try {
        const { data } = await axios.post(url, payload, {
          timeout: this.timeoutMs,
          headers: { 'Content-Type': 'application/json' }
        });
        if (data && data.ok === false) {
          throw new Error(`Bale API error: ${JSON.stringify(data)}`);
        }
        return data;
      } catch (err) {
        lastErr = err;
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
    throw lastErr;
  }
}

module.exports = { BaleClient };
