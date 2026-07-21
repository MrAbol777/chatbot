const { randomUUID } = require('crypto');
const { Readable } = require('stream');
function createFakeVideoProvider({ scenario = 'processing' } = {}) {
  const statuses = new Map();
  const polls = new Map();
  const planned = new Map();
  const submit = async () => { const id = `fake-${randomUUID()}`; planned.set(id, [scenario]); return { providerJobId: id, status: scenario === 'failed' ? 'failed' : 'submitted' }; };
  const next = (id) => {
    const values = planned.get(id) || ['failed']; const value = values.length > 1 ? values.shift() : values[0]; planned.set(id, values);
    polls.set(id, (polls.get(id) || 0) + 1);
    if (value === 'network_error') { const error = new Error('fake network error'); error.code = 'ECONNRESET'; throw error; }
    if (value === 'timeout') { const error = new Error('fake timeout'); error.code = 'ETIMEDOUT'; throw error; }
    if (value === 'http_429' || value === 'http_500') { const error = new Error('fake http error'); error.response = { status: Number(value.slice(5)) }; throw error; }
    if (value === 'malformed_response') return { malformed: true };
    return { status: value, result: value === 'succeeded' ? { source: `fake://${id}`, mimeType: 'video/mp4', filename: 'video.mp4' } : null };
  };
  return {
    kind: 'fake',
    submitTextToVideo: submit, submitImageToVideo: submit,
    getJobStatus: async (id) => next(id),
    plan: (id, values) => planned.set(id, Array.isArray(values) ? [...values] : [values]),
    pollCount: (id) => polls.get(id) || 0,
    normalizeStatus: (value) => ['queued','submitted','processing','succeeded','failed','cancelled'].includes(String(value?.status || value)) ? String(value?.status || value) : null,
    normalizeResult: (value) => value?.result || null,
    fetchResultStream: async (descriptor) => ({ stream: Readable.from([Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex')]), mimeType: descriptor?.mimeType || 'video/mp4', filename: descriptor?.filename || 'video.mp4' }),
    normalizeCost: () => null,
    sanitizeError: () => 'خطا در سرویس ساخت ویدیو رخ داد.'
  };
}
module.exports = { createFakeVideoProvider };
