import {
  ApiErrorData,
  ChatImageIntentResponse,
  ChatRequestError,
  ChatStreamEvent,
  ChatStreamPayload,
  PersonalityProfile
} from '../types/chat.types';

export const createChatRequestError = (message: string, status?: number, payload?: ApiErrorData): ChatRequestError => {
  const err = new Error(message) as ChatRequestError;
  err.status = status;
  err.payload = payload;
  return err;
};

export const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Wrap fetch with network-level error handling.
 * Catches DNS failures, offline, connection refused, etc.
 */
export const safeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('درخواست بیش از حد طول کشید. لطفاً دوباره تلاش کنید.');
    }
    throw new Error('اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.');
  }
};

const INTEREST_PATTERNS = [
  /(?:عاشق|دوست دارم|علاقه دارم)\s+([آ-یa-zA-Z0-9\s‌]+)/i,
  /(?:به\s+)?([آ-یa-zA-Z0-9\s‌]+)\s+علاقه دارم/i
];
const POSITIVE_EMOTION_REGEX = /(خوشحال|خوشحالم|عالیم|عالیه|هیجان زده|خوبم|راضیم)/i;
const NEGATIVE_EMOTION_REGEX = /(ناراحت|ناراحتم|غمگین|عصبانی|استرس|مضطرب|بدحالم|خسته ام|خسته‌ام)/i;

export const createDefaultPersonality = (): PersonalityProfile => ({
  interests: [],
  preferredStyle: 'casual',
  emotionState: 'neutral',
  messageCount: 0,
  lastTopics: []
});

export const normalizePersonality = (value: unknown): PersonalityProfile => {
  const source = value && typeof value === 'object' ? (value as Partial<PersonalityProfile>) : {};
  const style = source.preferredStyle;
  const emotion = source.emotionState;
  return {
    interests: Array.isArray(source.interests)
      ? source.interests.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 20)
      : [],
    preferredStyle: style === 'formal' || style === 'playful' || style === 'casual' ? style : 'casual',
    emotionState: emotion === 'happy' || emotion === 'sad' || emotion === 'neutral' ? emotion : 'neutral',
    messageCount: Number.isFinite(Number(source.messageCount)) ? Math.max(0, Number(source.messageCount)) : 0,
    lastTopics: Array.isArray(source.lastTopics)
      ? source.lastTopics
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .slice(-3)
      : []
  };
};

export const detectCategoryClient = (msg: string): 'academic' | 'emotional' | 'creative' | 'general' => {
  const lower = msg.toLowerCase();
  if (/ریاضی|علم|فرمول|معادله|چرا|چگونه|درس|مدرسه|فیزیک|شیمی|زیست/.test(lower)) return 'academic';
  if (/احساس|ناراحت|غمگین|ترس|استرس|خجالت|دعوا|دوست|رابطه|دوستی|مامان|بابا/.test(lower)) return 'emotional';
  if (/داستان|قصه|ایده|شخصیت|بنویس|نوشتن|خلاقیت|ماجراجویی/.test(lower)) return 'creative';
  return 'general';
};

export const mapCategoryToTopic = (category: 'academic' | 'emotional' | 'creative' | 'general') => {
  if (category === 'academic') return 'آموزشی';
  if (category === 'emotional') return 'احساسی';
  if (category === 'creative') return 'خلاقانه';
  return 'عمومی';
};

export const extractInterest = (message: string): string | null => {
  for (const pattern of INTEREST_PATTERNS) {
    const match = message.match(pattern);
    const candidate = match?.[1]?.replace(/[.!؟?,،]+$/g, '').trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 30) {
      return candidate;
    }
  }
  return null;
};

export const updatePersonalityFromMessage = (current: PersonalityProfile, message: string): PersonalityProfile => {
  const next: PersonalityProfile = {
    ...current,
    interests: [...current.interests],
    lastTopics: [...current.lastTopics],
    messageCount: current.messageCount + 1
  };

  const interest = extractInterest(message);
  if (interest && !next.interests.includes(interest)) {
    next.interests.push(interest);
  }

  if (POSITIVE_EMOTION_REGEX.test(message)) {
    next.emotionState = 'happy';
  } else if (NEGATIVE_EMOTION_REGEX.test(message)) {
    next.emotionState = 'sad';
  } else {
    next.emotionState = 'neutral';
  }

  const category = detectCategoryClient(message);
  const topic = mapCategoryToTopic(category);
  next.lastTopics = [...next.lastTopics.filter((item) => item !== topic), topic].slice(-3);
  return next;
};

export const postChatStream = async (
  payload: ChatStreamPayload,
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void | Promise<void>
): Promise<{ kind: 'json'; response: Response; data: ChatImageIntentResponse } | { kind: 'stream'; done: ChatStreamEvent }> => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...(localStorage.getItem('chat_auth_token')
        ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
        : {})
    },
    credentials: 'include',
    body: JSON.stringify(payload),
    signal
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/x-ndjson')) {
    let data: ChatImageIntentResponse & ApiErrorData = {};
    try { data = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      throw createChatRequestError(data.error || data.message || 'پاسخ سرور دریافت نشد.', response.status, data);
    }
    return { kind: 'json', response, data };
  }
  if (!response.ok || !response.body) {
    throw createChatRequestError('استریم پاسخ شروع نشد.', response.status, {});
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let doneEvent: ChatStreamEvent | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ChatStreamEvent;
        await onEvent(event);
        if (event.type === 'done') doneEvent = event;
        if (event.type === 'error') throw createChatRequestError(event.message || 'دریافت پاسخ ناموفق بود.', 502, { error: event.error });
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (!doneEvent) {
    throw createChatRequestError('پاسخ استریم به صورت کامل پایان نیافت.', 502, {});
  }

  return { kind: 'stream', done: doneEvent };
};
