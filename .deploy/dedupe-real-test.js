const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

let cookieHeader = '';
let guestId = '';

const updateCookies = (headers) => {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return;
  for (const part of setCookie.split(/,(?=[^;,]+=)/)) {
    const cookie = part.split(';')[0].trim();
    if (!cookie) continue;
    const [name, value] = cookie.split('=');
    if (name === 'danoa_guest_id') guestId = decodeURIComponent(value || '');
    const existing = cookieHeader
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !item.startsWith(`${name}=`));
    existing.push(cookie);
    cookieHeader = existing.join('; ');
  }
};

const requestJson = async (path, init = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(init.headers || {})
  };
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  updateCookies(response.headers);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${text}`);
  }
  return data;
};

const makeProfile = () => ({
  id: guestId ? `guest:${guestId}` : undefined,
  name: 'مهمان',
  age: 0,
  personality: {
    interests: [],
    preferredStyle: 'playful',
    emotionState: 'neutral',
    messageCount: 0,
    lastTopics: []
  }
});

const countImageMessages = (messages) =>
  (Array.isArray(messages) ? messages : []).filter(
    (message) =>
      message &&
      message.role === 'assistant' &&
      (message.type === 'image_result' || (Array.isArray(message.images) && message.images.length > 0))
  ).length;

const loadConversation = async (conversationId) => {
  const payload = await requestJson('/api/conversations/load', {
    method: 'POST',
    body: JSON.stringify({ profile: makeProfile() })
  });
  const conversation = (payload.items || []).find((item) => item.conversation_id === conversationId);
  return conversation || null;
};

const waitForTask = async (taskId, conversationId) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await requestJson(`/api/images/status/${encodeURIComponent(taskId)}?conversationId=${encodeURIComponent(conversationId)}`, {
      method: 'GET',
      headers: cookieHeader ? { Cookie: cookieHeader } : {}
    });
    if (status.status === 'COMPLETED' || status.status === 'ERROR') return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`task ${taskId} timed out`);
};

const sendPrompt = async (prompt, conversationId, history) => {
  const response = await requestJson('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: prompt,
      profile: makeProfile(),
      personality: makeProfile().personality,
      history,
      conversationId,
      clientMessageId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    })
  });
  if (!guestId) {
    throw new Error('guest cookie was not set');
  }
  if (!response.taskId) {
    throw new Error(`taskId missing: ${JSON.stringify(response)}`);
  }
  const finalStatus = await waitForTask(response.taskId, conversationId);
  return { response, finalStatus };
};

(async () => {
  const conversationId = `dedupe-real-${Date.now()}`;
  const first = await sendPrompt('موز آبی بساز', conversationId, []);
  const afterFirst = await loadConversation(conversationId);
  const firstImageCount = countImageMessages(afterFirst?.messages);

  const afterFirstHistory = (afterFirst?.messages || []).map((message) => ({
    role: message.role,
    content: message.content,
    images: message.images
  }));
  const refreshed = await loadConversation(conversationId);
  const refreshImageCount = countImageMessages(refreshed?.messages);

  const second = await sendPrompt('خرگوش خاکستری بساز', conversationId, afterFirstHistory);
  const afterSecond = await loadConversation(conversationId);
  const secondImageCount = countImageMessages(afterSecond?.messages);

  console.log(JSON.stringify({
    conversationId,
    guestId,
    firstTask: first.response.taskId,
    firstStatus: first.finalStatus.status,
    firstImageCount,
    refreshImageCount,
    secondTask: second.response.taskId,
    secondStatus: second.finalStatus.status,
    secondImageCount,
    imageMessages: (afterSecond?.messages || [])
      .filter((message) => message.role === 'assistant' && (message.type || '').startsWith('image'))
      .map((message) => ({
        id: message.id,
        type: message.type,
        taskId: message.taskId,
        status: message.status,
        imageUrl: message.imageUrl || message.resultUrl || message.images?.[0]?.url,
        content: String(message.content || '').slice(0, 40)
      }))
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
