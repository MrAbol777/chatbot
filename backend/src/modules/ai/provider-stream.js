const createAbortError = () => {
  const error = new Error('PROVIDER_REQUEST_ABORTED');
  error.name = 'AbortError';
  error.code = 'PROVIDER_REQUEST_ABORTED';
  return error;
};

const throwForHttpError = async (response) => {
  if (response.ok) return;
  let details = '';
  try {
    details = await response.text();
  } catch (_error) {
    details = response.statusText || 'upstream_error';
  }
  const error = new Error('UPSTREAM_REQUEST_FAILED');
  error.code = 'UPSTREAM_REQUEST_FAILED';
  error.details = { status: response.status, details: details.slice(0, 4000) };
  throw error;
};

async function consumeSseResponse(response, onData, signal) {
  await throwForHttpError(response);
  if (!response.body) {
    const error = new Error('EMPTY_UPSTREAM_STREAM');
    error.code = 'EMPTY_UPSTREAM_REPLY';
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw createAbortError();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) await onData(data);
      }
      if (done) break;
    }

    const tail = buffer.trim();
    if (tail) {
      const data = tail
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) await onData(data);
    }
  } finally {
    reader.releaseLock();
  }
}

async function streamOpenAIChat({ endpoint, apiKey, payload, signal, onDelta }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } }),
    signal
  });

  let tokenUsage = null;
  await consumeSseResponse(response, async (data) => {
    if (data === '[DONE]') return;
    const chunk = JSON.parse(data);
    if (chunk?.usage) tokenUsage = chunk.usage;
    const content = chunk?.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content) await onDelta(content);
  }, signal);
  return { tokenUsage };
}

async function streamGeminiContent({ endpoint, apiKey, payload, signal, onDelta }) {
  const separator = endpoint.includes('?') ? '&' : '?';
  const response = await fetch(`${endpoint}${separator}alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(payload),
    signal
  });

  let tokenUsage = null;
  await consumeSseResponse(response, async (data) => {
    if (data === '[DONE]') return;
    const chunk = JSON.parse(data);
    if (chunk?.usageMetadata) tokenUsage = chunk.usageMetadata;
    const parts = chunk?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
      : '';
    if (text) await onDelta(text);
  }, signal);
  return { tokenUsage };
}

module.exports = {
  consumeSseResponse,
  streamOpenAIChat,
  streamGeminiContent
};
