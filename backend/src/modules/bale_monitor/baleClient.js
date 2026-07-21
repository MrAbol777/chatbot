const axios = require('axios');

class BaleClient {
  constructor(token, timeoutMs = 10000, retries = 2) {
    this.baseUrl = `https://tapi.bale.ai/bot${token}`;
    this.timeoutMs = timeoutMs;
    this.retries = Math.max(1, retries);
  }

  async sendMessage(chatId, text) {
    return this._call('sendMessage', { chat_id: chatId, text });
  }

  async setWebhook(url) {
    return this._call('setWebhook', { url });
  }

  async deleteWebhook() {
    return this._call('deleteWebhook', {});
  }

  async getWebhookInfo() {
    return this._call('getWebhookInfo', {});
  }

  async getUpdates(offset, timeout = 0) {
    return this._call('getUpdates', { offset, timeout });
  }

  async _call(method, payload) {
    const url = `${this.baseUrl}/${method}`;

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
