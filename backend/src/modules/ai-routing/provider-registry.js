'use strict';

class AiProviderRegistry {
  constructor() { this.adapters = new Map(); }

  register(adapter) {
    const key = String(adapter?.getProviderKey?.() || '').trim();
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(key)) throw new Error('AI_PROVIDER_KEY_INVALID');
    if (this.adapters.has(key)) throw new Error(`AI_PROVIDER_DUPLICATE:${key}`);
    if (typeof adapter.getCapabilities !== 'function' || typeof adapter.submit !== 'function' || typeof adapter.getJobStatus !== 'function') {
      throw new Error(`AI_PROVIDER_ADAPTER_INVALID:${key}`);
    }
    this.adapters.set(key, adapter);
    return this;
  }

  get(key) {
    const normalized = String(key || '').trim();
    const adapter = this.adapters.get(normalized);
    if (!adapter) throw new Error(`AI_PROVIDER_UNKNOWN:${normalized}`);
    return adapter;
  }

  has(key) { return this.adapters.has(String(key || '').trim()); }
  keys() { return Object.freeze([...this.adapters.keys()]); }
}

module.exports = { AiProviderRegistry };

