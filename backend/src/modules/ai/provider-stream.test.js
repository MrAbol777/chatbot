const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeSseResponse } = require('./provider-stream');

test('consumeSseResponse preserves Persian UTF-8 split across byte boundaries', async () => {
  const source = 'data: {"text":"سلام دنیا 🌟"}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(source);
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 3) chunks.push(bytes.slice(index, index + 3));
  const response = new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const events = [];
  await consumeSseResponse(response, (data) => events.push(data));
  assert.deepEqual(events, ['{"text":"سلام دنیا 🌟"}', '[DONE]']);
});

test('consumeSseResponse stops when AbortSignal is aborted', async () => {
  const abortController = new AbortController();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"text":"شروع"}\n\n'));
    },
    cancel() {}
  }), { status: 200 });
  await assert.rejects(
    consumeSseResponse(response, () => abortController.abort(), abortController.signal),
    (error) => error?.code === 'PROVIDER_REQUEST_ABORTED'
  );
});
