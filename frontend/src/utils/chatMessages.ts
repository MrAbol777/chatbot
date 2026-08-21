import { ChatMessage, Conversation } from '../types';
import {
  AuthMode,
  ApiError,
  ApiErrorData
} from '../types/chat.types';

export const THEME_KEY = 'danoa_theme';
export const SIDEBAR_COLLAPSED_KEY = 'danoa_sidebar_collapsed';
export const DEFAULT_TITLE = 'گفتگوی جدید';
export const CONVERSATION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isDesktopChatLayout = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1200px)').matches;

export const getInitialSidebarState = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!isDesktopChatLayout()) return false;
  try {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (saved !== null) {
      return saved !== 'true';
    }
  } catch {
    // fallback
  }
  return true;
};

export const parseApiError = async (response: Response): Promise<ApiErrorData> => {
  try {
    return (await response.json()) as ApiErrorData;
  } catch {
    return {};
  }
};

export const buildRequestErrorMessage = async (response: Response): Promise<string> => {
  if (response.status === 401 || response.status === 403) {
    return 'احراز هویت API نامعتبر است. لطفاً کلید API را در بک اند بررسی کن.';
  }

  const payload = await parseApiError(response);
  if (payload.error?.trim()) {
    return payload.error.trim();
  }
  if (payload.message?.trim()) {
    return payload.message.trim();
  }

  return 'پاسخ سرور دریافت نشد.';
};

export const createApiError = (
  message: string,
  redirectTo?: AuthMode | null,
  status?: number,
  retryAfterSeconds?: number
): ApiError => {
  const error = new Error(message) as ApiError;
  if (redirectTo) {
    error.redirectTo = redirectTo;
  }
  if (Number.isInteger(status)) {
    error.status = status;
  }
  if (Number.isFinite(Number(retryAfterSeconds)) && Number(retryAfterSeconds) > 0) {
    error.retryAfterSeconds = Math.ceil(Number(retryAfterSeconds));
  }
  return error;
};

export const normalizeLocalizedDigits = (value: string): string =>
  value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));

export const normalizePhoneInput = (value: string): string =>
  normalizeLocalizedDigits(value).trim().replace(/[-\s]/g, '');

export const parseAgeInput = (value: string): number => {
  const normalized = normalizeLocalizedDigits(value.trim());
  if (!normalized || !/^[0-9]+$/.test(normalized)) {
    return Number.NaN;
  }
  return Number(normalized);
};

export const filterLocalizedDigits = (value: string): string =>
  value.replace(/[^0-9۰-۹٠-٩]/g, '');

export const formatConversationDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

  if (diffDays <= 0) {
    return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (diffDays === 1) {
    return 'دیروز';
  }
  if (diffDays < 7) {
    return `${new Intl.NumberFormat('fa-IR').format(diffDays)} روز پیش`;
  }

  return new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' }).format(date);
};

export const getConversationPreview = (conversation: Conversation): string => {
  const lastMessage = [...conversation.messages].reverse().find((message) => message.content.trim());
  return lastMessage?.content.trim() || `${new Intl.NumberFormat('fa-IR').format(conversation.messages.length)} پیام`;
};

export const formatMessageTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(date);
};

export const imageMessagePriority = (message: ChatMessage): number => {
  if (message.type === 'image_result') return 30;
  if (message.type === 'image_error') return 20;
  if (message.type === 'image_loading') return 10;
  if (getMessageTaskId(message) && message.status && message.status !== 'COMPLETED' && message.status !== 'ERROR') return 8;
  return 0;
};

export const normalizeImageDedupeUrl = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return url.pathname.replace(/\/+$/, '') || url.pathname;
  } catch {
    return raw.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
};

export const getMessageTaskId = (message: ChatMessage): string => {
  const candidate = message.taskId ?? (message as any).imageTaskId;
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).trim() : '';
};

export const getMessageImageUrls = (message: ChatMessage): string[] => {
  const urls = [
    message.imageUrl,
    (message as any).resultUrl,
    Array.isArray(message.images) ? message.images[0]?.url : undefined,
    ...(Array.isArray(message.images) ? message.images.map((image: { url?: string } | undefined) => image?.url) : [])
  ];
  return Array.from(
    new Set(
      urls
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter(Boolean)
    )
  );
};

export const getMessageImageDedupeUrls = (message: ChatMessage): string[] =>
  Array.from(new Set(getMessageImageUrls(message).map(normalizeImageDedupeUrl).filter(Boolean)));

export const getImageMessageCompletenessScore = (message: ChatMessage): number => {
  const hasImage = getMessageImageDedupeUrls(message).length > 0 ? 6 : 0;
  const completed = message.status === 'COMPLETED' ? 4 : 0;
  const readyText = /عکس آماده شد|تصویر آماده شد/.test(message.content || '') ? 2 : 0;
  const task = getMessageTaskId(message) ? 1 : 0;
  return imageMessagePriority(message) + hasImage + completed + readyText + task;
};

export const mergeImageTaskMessages = (current: ChatMessage, next: ChatMessage): ChatMessage => {
  const currentPriority = getImageMessageCompletenessScore(current);
  const nextPriority = getImageMessageCompletenessScore(next);
  const base = nextPriority >= currentPriority ? next : current;
  const fallback = base === next ? current : next;
  const taskId = getMessageTaskId(current) || getMessageTaskId(next);
  const images = getMessageImageUrls(base).length > 0 ? base.images : fallback.images;
  const imageUrl = base.imageUrl || fallback.imageUrl;
  const resultUrl = (base as any).resultUrl || (fallback as any).resultUrl;

  return {
    ...fallback,
    ...base,
    id: current.id || next.id,
    timestamp: current.timestamp || next.timestamp,
    ...(taskId ? { taskId } : {}),
    ...(images ? { images } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(resultUrl ? { resultUrl } : {})
  };
};

export const dedupeChatMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const deduped: ChatMessage[] = [];
  const taskIndexes = new Map<string, number>();
  const imageUrlIndexes = new Map<string, number>();

  const rememberImageMessage = (message: ChatMessage, index: number) => {
    const taskId = getMessageTaskId(message);
    if (taskId) {
      taskIndexes.set(taskId, index);
    }
    getMessageImageDedupeUrls(message).forEach((url) => imageUrlIndexes.set(url, index));
  };

  for (const message of messages) {
    const taskId = getMessageTaskId(message);
    const isImageTaskMessage =
      message.role === 'assistant' &&
      (message.type === 'image_loading' ||
        message.type === 'image_result' ||
        message.type === 'image_error' ||
        Boolean(taskId && message.status));

    if (isImageTaskMessage) {
      const normalizedTaskMessage =
        taskId && message.type !== 'image_result' && message.type !== 'image_error'
          ? { ...message, type: 'image_loading' as const, taskId }
          : taskId
            ? { ...message, taskId }
            : message;
      const imageUrls = getMessageImageDedupeUrls(message);
      const existingIndex =
        (taskId ? taskIndexes.get(taskId) : undefined) ??
        imageUrls.map((url) => imageUrlIndexes.get(url)).find((index) => index !== undefined);

      if (existingIndex !== undefined) {
        const merged = mergeImageTaskMessages(deduped[existingIndex], normalizedTaskMessage);
        deduped[existingIndex] = merged;
        rememberImageMessage(merged, existingIndex);
        continue;
      }

      deduped.push(normalizedTaskMessage);
      rememberImageMessage(normalizedTaskMessage, deduped.length - 1);
      continue;
    }

    if (message.role === 'assistant' && getMessageImageDedupeUrls(message).length > 0) {
      const imageUrls = getMessageImageDedupeUrls(message);
      const existingIndex = imageUrls.map((url) => imageUrlIndexes.get(url)).find((index) => index !== undefined);
      if (existingIndex !== undefined) {
        deduped[existingIndex] = mergeImageTaskMessages(deduped[existingIndex], {
          ...message,
          type: message.type || 'image_result'
        });
        rememberImageMessage(deduped[existingIndex], existingIndex);
        continue;
      }
    }

    deduped.push(message);
    if (message.role === 'assistant') {
      rememberImageMessage(message, deduped.length - 1);
    }
  }

  const seenFinalImageUrls = new Set<string>();
  return deduped.filter((message) => {
    if (message.role !== 'assistant' || getMessageImageDedupeUrls(message).length === 0) {
      return true;
    }

    const imageUrls = getMessageImageDedupeUrls(message);
    if (imageUrls.some((url) => seenFinalImageUrls.has(url))) {
      return false;
    }

    imageUrls.forEach((url) => seenFinalImageUrls.add(url));
    return true;
  });
};

export const normalizeConversationFromServer = (item: {
  conversation_id: string;
  title?: string | null;
  pinned?: boolean;
  created_at?: string;
  updated_at?: string;
  messages?: ChatMessage[];
}): Conversation => {
  const createdAt = item.created_at || new Date().toISOString();
  const updatedAt = item.updated_at || createdAt;
  const messages = Array.isArray(item.messages)
    ? dedupeChatMessages(item.messages.map((msg) => ({
        id: typeof msg.id === 'string' ? msg.id : undefined,
        role: msg.role,
        type: msg.type,
        intent: msg.intent,
        content: msg.content,
        timestamp: msg.timestamp || updatedAt,
        taskId: msg.taskId,
        imageTaskId: (msg as any).imageTaskId,
        status: msg.status,
        imageUrl: msg.imageUrl,
        resultUrl: (msg as any).resultUrl,
        images: Array.isArray(msg.images)
          ? msg.images
              .filter((image: any) => image && typeof image.url === 'string' && image.url.trim().length > 0)
              .map((image: any) => ({
                url: image.url.trim(),
                alt: typeof image.alt === 'string' && image.alt.trim() ? image.alt.trim() : 'تصویر ارسال شده'
              }))
          : undefined
      })))
    : [];

  return {
    id: item.conversation_id || `${Date.now()}`,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : DEFAULT_TITLE,
    pinned: Boolean(item.pinned),
    createdAt,
    updatedAt,
    messages
  };
};

export const generateUniqueId = (): number => Date.now() + Math.floor(Math.random() * 10000);
export const generateMessageId = (prefix = 'msg'): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const getDefaultThemeByAge = (age: number): 'energy' | 'calm' => (age < 13 ? 'energy' : 'calm');
