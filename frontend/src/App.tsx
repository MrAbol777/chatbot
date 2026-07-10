import { ChangeEvent, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Conversation, UserProfile } from './types';
import AdminLogin from './AdminLogin';
import AdminPanel from './AdminPanel';
import DanuaLanding from './DanuaLanding';
import PlansPage from './PlansPage';
import PaymentSuccessPage from './PaymentSuccessPage';
import defaultBotAvatar from './image.png';
import {
  fetchProtectedImageBlobUrl,
  getImageGenerationStatusForConversation,
  startImageGeneration
} from './services/imageGeneration';
import { Button, Dialog, TextField, ToastProvider, useToast } from './design-system/components';
import DesignSystemPreview from './design-system/preview/DesignSystemPreview';

const PROFILE_KEY = 'chat_profile';
const PROFILES_KEY = 'chat_profiles';
const CONVERSATIONS_KEY = 'chat_conversations';
const ACTIVE_CONVERSATION_KEY = 'chat_active_conversation_id';
const THEME_KEY = 'danoa_theme';
const DEFAULT_TITLE = 'گفتگوی جدید';
const GUEST_PROFILE_KEY = 'chat_guest_profile';
const CONVERSATION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WAITING_MESSAGES = [
  'در حال یافتن پاسخ',
  'در حال بررسی سوال شما',
  'نزدیک به پایان',
  'لحظاتی دیگر پاسخ می دهم'
];
const IMAGE_PROMPT_EXAMPLES = [
  'یک ربات مهربان در حال کمک به کودک برای حل تمرین، سبک کارتونی نرم',
  'یک شهر آینده‌نگر رنگی در غروب، پرجزئیات و شاد',
  'پوستر کودکانه درباره مراقبت از زمین، رنگ‌های روشن و فضای امیدبخش'
];
const IMAGE_PROMPT_MAX_LENGTH = 700;
const CHAT_REQUEST_TIMEOUT_MS = 35000;
const CHAT_MAX_RETRIES = 1;
const BOT_AVATAR_FALLBACK_URL = '/image.png';

type AppProfile = UserProfile & { id?: number | string };
type RecordingAction = 'idle' | 'confirm' | 'cancel';
type LandingStep = 'landing' | 'login' | 'signup' | 'chat';
type AppView = 'home' | 'chat' | 'generate' | 'profile';
type PersonalityProfile = {
  interests: string[];
  preferredStyle: 'formal' | 'casual' | 'playful';
  emotionState: 'happy' | 'sad' | 'neutral';
  messageCount: number;
  lastTopics: string[];
};
type AuthMode = 'login' | 'signup';
type ApiErrorData = {
  error?: string;
  message?: string;
  details?: string;
  redirectTo?: AuthMode | null;
  limit?: number;
  usage?: number;
  remaining?: number;
  nextAction?: string;
};
type AuthFamilyPayload = {
  child?: {
    id: string;
    name: string;
    age: number;
    avatar?: string | null;
    grade?: string | null;
    safetyLevel?: string;
  } | null;
  guardian?: {
    id?: string | null;
    phone?: string | null;
  } | null;
};
type VerifyCodeResult = {
  success: boolean;
  isNewUser?: boolean;
  requiresProfile?: boolean;
  signupToken?: string;
  userId?: string;
  profile?: { name: string; age: number; phone: string };
  token?: string;
} & AuthFamilyPayload;
type PhoneStatusResult = {
  success: boolean;
  exists: boolean;
  recommendedMode: AuthMode;
  redirectTo?: AuthMode | null;
};

const getAppViewFromPath = (pathname: string): AppView => {
  if (pathname === '/chat') return 'chat';
  if (pathname === '/generate' || pathname === '/photos') return 'generate';
  if (pathname === '/profile' || pathname === '/settings') return 'profile';
  return 'home';
};
type ApiError = Error & { redirectTo?: AuthMode | null };
type ChatRequestError = Error & { status?: number; payload?: ApiErrorData };
type GuestLimitInfo = {
  limit: number;
  usage: number;
  remaining: number;
};
type ChatImageIntentResponse = {
  intent?: 'chat' | 'image_generation' | 'image_edit' | 'image_understanding';
  status?: 'QUEUE' | 'WAITING' | 'RUNNING' | 'COMPLETED' | 'ERROR';
  assistantText?: string;
  taskId?: string;
  error?: string;
  reason?: string | null;
  blocked?: boolean;
  unsupported?: boolean;
  messages?: ChatMessage[];
  reply?: string;
  conversationId?: string;
};
type AttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'error';
type ImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  status: AttachmentStatus;
  imageId?: string;
  error?: string;
};
type ImagePreviewState = {
  src: string;
  alt: string;
  downloadName: string;
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const RETRYABLE_API_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Wrap fetch with network-level error handling.
 * Catches DNS failures, offline, connection refused, etc.
 */
const safeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('درخواست بیش از حد طول کشید. لطفاً دوباره تلاش کنید.');
    }
    throw new Error('اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.');
  }
};

const withImageRetryParam = (src: string, retry: number): string => {
  if (retry <= 0) {
    return src;
  }

  try {
    const url = new URL(src, window.location.origin);
    url.searchParams.set('retry', String(retry));
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}retry=${retry}`;
  }
};

const buildImageDownloadName = (src: string, index?: number): string => {
  const suffix = typeof index === 'number' ? `-${index + 1}` : '';
  try {
    const url = new URL(src, window.location.origin);
    const fileName = url.pathname.split('/').filter(Boolean).pop();
    if (fileName && fileName.includes('.')) {
      return fileName;
    }
  } catch {
    // Keep the friendly fallback below for relative or blob URLs.
  }
  return `danoa-image${suffix}.jpg`;
};

const MessageImage = ({
  src,
  alt,
  index,
  onOpenPreview
}: {
  src: string;
  alt: string;
  index?: number;
  onOpenPreview: (image: ImagePreviewState) => void;
}) => {
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const protectedBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setRetryCount(0);
    setFailed(false);
    setResolvedSrc(src);
    if (protectedBlobUrlRef.current) {
      URL.revokeObjectURL(protectedBlobUrlRef.current);
      protectedBlobUrlRef.current = null;
    }

    if (!src.startsWith('/api/images/result/') && !src.startsWith('/api/images/serve/')) {
      return;
    }

    let cancelled = false;
    fetchProtectedImageBlobUrl(src)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        protectedBlobUrlRef.current = blobUrl;
        setResolvedSrc(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (protectedBlobUrlRef.current) {
        URL.revokeObjectURL(protectedBlobUrlRef.current);
        protectedBlobUrlRef.current = null;
      }
    };
  }, [src]);

  if (failed) {
    return (
      <div className="image-load-error">
        ⚠️ خطا در بارگذاری تصویر — لطفاً دوباره تلاش کنید
      </div>
    );
  }

  const displaySrc = resolvedSrc.startsWith('blob:') ? resolvedSrc : withImageRetryParam(resolvedSrc, retryCount);
  const downloadName = buildImageDownloadName(src, index);

  return (
    <figure className="generated-image-card">
      <button
        type="button"
        className="generated-image-preview"
        onClick={() => onOpenPreview({ src: displaySrc, alt, downloadName })}
        aria-label="مشاهده تصویر"
      >
        <img
          className="message-image"
          src={displaySrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (retryCount >= 5) {
              setFailed(true);
              return;
            }

            window.setTimeout(() => {
              setRetryCount((current) => current + 1);
            }, 700 + retryCount * 500);
          }}
        />
        <span className="generated-image-hover" aria-hidden="true">
          <span>مشاهده</span>
        </span>
      </button>
      <figcaption className="generated-image-actions">
        <span className="generated-image-label">تصویر آماده شد</span>
        <a className="generated-image-download" href={displaySrc} download={downloadName}>
          دانلود
        </a>
      </figcaption>
    </figure>
  );
};

const PERSIAN_PHONE_REGEX = /^09[0-9]{9}$/;
const INTEREST_PATTERNS = [
  /(?:عاشق|دوست دارم|علاقه دارم)\s+([آ-یa-zA-Z0-9\s‌]+)/i,
  /(?:به\s+)?([آ-یa-zA-Z0-9\s‌]+)\s+علاقه دارم/i
];
const POSITIVE_EMOTION_REGEX = /(خوشحال|خوشحالم|عالیم|عالیه|هیجان زده|خوبم|راضیم)/i;
const NEGATIVE_EMOTION_REGEX = /(ناراحت|ناراحتم|غمگین|عصبانی|استرس|مضطرب|بدحالم|خسته ام|خسته‌ام)/i;

const createDefaultPersonality = (): PersonalityProfile => ({
  interests: [],
  preferredStyle: 'casual',
  emotionState: 'neutral',
  messageCount: 0,
  lastTopics: []
});

const normalizePersonality = (value: unknown): PersonalityProfile => {
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

const detectCategoryClient = (msg: string): 'academic' | 'emotional' | 'creative' | 'general' => {
  const lower = msg.toLowerCase();
  if (/ریاضی|علم|فرمول|معادله|چرا|چگونه|درس|مدرسه|فیزیک|شیمی|زیست/.test(lower)) return 'academic';
  if (/احساس|ناراحت|غمگین|ترس|استرس|خجالت|دعوا|دوست|رابطه|دوستی|مامان|بابا/.test(lower)) return 'emotional';
  if (/داستان|قصه|ایده|شخصیت|بنویس|نوشتن|خلاقیت|ماجراجویی/.test(lower)) return 'creative';
  return 'general';
};

const mapCategoryToTopic = (category: 'academic' | 'emotional' | 'creative' | 'general') => {
  if (category === 'academic') return 'آموزشی';
  if (category === 'emotional') return 'احساسی';
  if (category === 'creative') return 'خلاقانه';
  return 'عمومی';
};

const extractInterest = (message: string): string | null => {
  for (const pattern of INTEREST_PATTERNS) {
    const match = message.match(pattern);
    const candidate = match?.[1]?.replace(/[.!؟?,،]+$/g, '').trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 30) {
      return candidate;
    }
  }
  return null;
};

const updatePersonalityFromMessage = (current: PersonalityProfile, message: string): PersonalityProfile => {
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

const postChatWithRetry = async (payload: {
  message: string;
  imageIds?: string[];
  profile: UserProfile;
  personality: PersonalityProfile;
  conversationId?: string;
  clientMessageId?: string;
}) => {
  for (let attempt = 0; attempt <= CHAT_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await safeFetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('chat_auth_token')
            ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
            : {})
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (response.ok || !RETRYABLE_API_STATUSES.has(response.status) || attempt >= CHAT_MAX_RETRIES) {
        return response;
      }

      const backoffDelay = Math.min(400 * 2 ** attempt, 1200);
      await wait(backoffDelay);
    } catch (error) {
      if (attempt >= CHAT_MAX_RETRIES) {
        throw error;
      }
      const backoffDelay = Math.min(400 * 2 ** attempt, 1200);
      await wait(backoffDelay);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw new Error('chat_request_failed');
};

const parseApiError = async (response: Response): Promise<ApiErrorData> => {
  try {
    return (await response.json()) as ApiErrorData;
  } catch {
    return {};
  }
};

const buildRequestErrorMessage = async (response: Response) => {
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

const createApiError = (message: string, redirectTo?: AuthMode | null): ApiError => {
  const error = new Error(message) as ApiError;
  if (redirectTo) {
    error.redirectTo = redirectTo;
  }
  return error;
};

const isGuestProfile = (value: AppProfile | null): boolean => Boolean(value && !value.phone);

const createGuestProfile = (): AppProfile => ({
  name: 'مهمان',
  age: 0,
  personality: createDefaultPersonality()
});

const normalizeLocalizedDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));

const normalizePhoneInput = (value: string) => normalizeLocalizedDigits(value).trim().replace(/[-\s]/g, '');

const parseAgeInput = (value: string) => {
  const normalized = normalizeLocalizedDigits(value.trim());
  if (!normalized || !/^[0-9]+$/.test(normalized)) {
    return Number.NaN;
  }
  return Number(normalized);
};

const filterLocalizedDigits = (value: string) => value.replace(/[^0-9۰-۹٠-٩]/g, '');

const createChatRequestError = (message: string, status: number, payload?: ApiErrorData): ChatRequestError => {
  const error = new Error(message) as ChatRequestError;
  error.status = status;
  error.payload = payload;
  return error;
};

const isMessageLimitError = (error: unknown): error is ChatRequestError => {
  if (!(error instanceof Error)) {
    return false;
  }
  const requestError = error as ChatRequestError;
  const payloadText = [requestError.message, requestError.payload?.error, requestError.payload?.message, requestError.payload?.details]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    requestError.status === 402 ||
    requestError.payload?.error === 'GUEST_LIMIT_REACHED' ||
    payloadText.includes('message limit') ||
    payloadText.includes('limit reached') ||
    payloadText.includes('daily limit') ||
    payloadText.includes('quota') ||
    payloadText.includes('سقف پیام') ||
    payloadText.includes('محدودیت پیام') ||
    payloadText.includes('پیام‌های رایگان') ||
    payloadText.includes('پیام رایگان')
  );
};
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENT_COUNT = 5;
const PUBLIC_SETTINGS_DEFAULTS = {
  'guest.limit_modal.title': 'برای ادامه از والد کمک بگیر',
  'guest.limit_modal.heading': 'برای نگه داشتن گفتگوها، شماره والد لازم است',
  'guest.limit_modal.body': 'گفتگوی مهمان به سقف پیام‌ها رسیده؛ با کمک والد می‌توانی همین گفتگوها را ذخیره کنی و ادامه بدهی.',
  'guest.limit_modal.badge_text': '۱۰',
  'guest.limit_modal.cta': 'ذخیره با کمک والد',
  'upload.image.max_size_mb': 5,
  'upload.image.max_files': 5,
  'upload.image.allowed_types': ['image/jpeg', 'image/png', 'image/webp'],
  'auth.validation.age_min': 8,
  'auth.validation.age_max': 18
};
type PublicSettings = typeof PUBLIC_SETTINGS_DEFAULTS & Record<string, any>;

const sendVerificationCode = async (phone: string, mode: AuthMode): Promise<void> => {
  const response = await safeFetch('/api/send-verification-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ phone, mode })
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'ارسال کد تایید انجام نشد.', payload.redirectTo ?? null);
  }
};

const verifyCode = async (phone: string, code: string, mode: AuthMode): Promise<VerifyCodeResult> => {
  const normalizedCode = String(code || '')
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));

  const response = await safeFetch('/api/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ phone, code: normalizedCode, mode })
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'تایید کد انجام نشد.', payload.redirectTo ?? null);
  }

  return (await response.json()) as VerifyCodeResult;
};

const checkPhoneStatus = async (phone: string, mode: AuthMode): Promise<PhoneStatusResult> => {
  const response = await safeFetch('/api/auth/phone-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ phone, mode })
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'بررسی شماره انجام نشد.', payload.redirectTo ?? null);
  }

  return (await response.json()) as PhoneStatusResult;
};

const registerProfile = async (profile: {
  name: string;
  age: number | string;
  phone: string;
  id?: number | string;
  mode: AuthMode;
  signupToken?: string;
}): Promise<{ userId: string; profile: { name: string; age: number; phone: string }; token?: string } & AuthFamilyPayload> => {
  const response = await safeFetch('/api/register-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'ثبت پروفایل انجام نشد.', payload.redirectTo ?? null);
  }

  return (await response.json()) as { userId: string; profile: { name: string; age: number; phone: string }; token?: string } & AuthFamilyPayload;
};

const loadRemoteConversations = async (profile: UserProfile & { id?: string | number }) => {
  const response = await safeFetch('/api/conversations/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ profile })
  });
  if (!response.ok) {
    throw new Error('بارگذاری گفتگوها انجام نشد.');
  }
  return (await response.json()) as {
    success: boolean;
    userId: string;
    items: Array<{
      conversation_id: string;
      title?: string | null;
      pinned?: boolean;
      created_at?: string;
      updated_at?: string;
      messages?: ChatMessage[];
    }>;
  };
};

const syncRemoteConversations = async (profile: UserProfile & { id?: string | number }, conversations: Conversation[]) => {
  try {
    const response = await safeFetch('/api/conversations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ profile, items: conversations })
    });
    if (!response.ok) {
      console.warn('[conversations] Sync failed:', response.status);
    }
  } catch (error) {
    console.error('[conversations] Sync error:', error);
  }
};

const createRemoteConversation = async (profile: UserProfile & { id?: string | number }) => {
  const response = await safeFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ profile })
  });
  if (!response.ok) {
    throw new Error('ساخت گفتگوی جدید انجام نشد.');
  }
  const payload = await response.json() as {
    conversationId: string;
    item?: {
      conversation_id: string;
      title?: string | null;
      pinned?: boolean;
      created_at?: string;
      updated_at?: string;
      messages?: ChatMessage[];
    };
  };
  if (payload.item) {
    return normalizeConversationFromServer(payload.item);
  }
  const now = new Date().toISOString();
  return {
    id: payload.conversationId,
    title: DEFAULT_TITLE,
    messages: [],
    pinned: false,
    createdAt: now,
    updatedAt: now
  } as Conversation;
};

const createConversation = (): Conversation => {
  const now = new Date().toISOString();
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    title: DEFAULT_TITLE,
    messages: [],
    pinned: false,
    createdAt: now,
    updatedAt: now
  };
};

const sortConversations = (items: Conversation[]): Conversation[] => {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};

const conversationVisuals = [
  { icon: '📖', tone: 'yellow' },
  { icon: '🌙', tone: 'indigo' },
  { icon: '🎨', tone: 'orange' },
  { icon: '🤖', tone: 'teal' },
  { icon: '❓', tone: 'blue' }
];

const formatConversationDate = (value: string): string => {
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

const getConversationPreview = (conversation: Conversation): string => {
  const lastMessage = [...conversation.messages].reverse().find((message) => message.content.trim());
  return lastMessage?.content.trim() || `${new Intl.NumberFormat('fa-IR').format(conversation.messages.length)} پیام`;
};

const formatMessageTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(date);
};

const imageMessagePriority = (message: ChatMessage): number => {
  if (message.type === 'image_result') return 30;
  if (message.type === 'image_error') return 20;
  if (message.type === 'image_loading') return 10;
  if (getMessageTaskId(message) && message.status && message.status !== 'COMPLETED' && message.status !== 'ERROR') return 8;
  return 0;
};

const normalizeImageDedupeUrl = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw, window.location.origin);
    return url.pathname.replace(/\/+$/, '') || url.pathname;
  } catch {
    return raw.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
};

const getMessageTaskId = (message: ChatMessage): string => {
  const candidate = message.taskId ?? message.imageTaskId;
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).trim() : '';
};

const getMessageImageUrls = (message: ChatMessage): string[] => {
  const urls = [
    message.imageUrl,
    message.resultUrl,
    Array.isArray(message.images) ? message.images[0]?.url : undefined,
    ...(Array.isArray(message.images) ? message.images.map((image) => image?.url) : [])
  ];
  return Array.from(
    new Set(
      urls
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter(Boolean)
    )
  );
};

const getMessageImageDedupeUrls = (message: ChatMessage): string[] =>
  Array.from(new Set(getMessageImageUrls(message).map(normalizeImageDedupeUrl).filter(Boolean)));

const getImageMessageCompletenessScore = (message: ChatMessage): number => {
  const hasImage = getMessageImageDedupeUrls(message).length > 0 ? 6 : 0;
  const completed = message.status === 'COMPLETED' ? 4 : 0;
  const readyText = /عکس آماده شد|تصویر آماده شد/.test(message.content || '') ? 2 : 0;
  const task = getMessageTaskId(message) ? 1 : 0;
  return imageMessagePriority(message) + hasImage + completed + readyText + task;
};

const mergeImageTaskMessages = (current: ChatMessage, next: ChatMessage): ChatMessage => {
  const currentPriority = getImageMessageCompletenessScore(current);
  const nextPriority = getImageMessageCompletenessScore(next);
  const base = nextPriority >= currentPriority ? next : current;
  const fallback = base === next ? current : next;
  const taskId = getMessageTaskId(current) || getMessageTaskId(next);
  const images = getMessageImageUrls(base).length > 0 ? base.images : fallback.images;
  const imageUrl = base.imageUrl || fallback.imageUrl;
  const resultUrl = base.resultUrl || fallback.resultUrl;

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

const dedupeChatMessages = (messages: ChatMessage[]): ChatMessage[] => {
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

const normalizeConversationFromServer = (item: {
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
        imageTaskId: msg.imageTaskId,
        status: msg.status,
        imageUrl: msg.imageUrl,
        resultUrl: msg.resultUrl,
        images: Array.isArray(msg.images)
          ? msg.images
              .filter((image) => image && typeof image.url === 'string' && image.url.trim().length > 0)
              .map((image) => ({
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

const inferTitle = (text: string): string => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return DEFAULT_TITLE;
  }
  const words = cleaned.split(' ').slice(0, 5).join(' ');
  return words.length > 28 ? `${words.slice(0, 28)}...` : words;
};

const generateUniqueId = () => Date.now() + Math.floor(Math.random() * 10000);
const generateMessageId = (prefix = 'msg') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const getDefaultThemeByAge = (age: number): 'energy' | 'calm' => (age < 13 ? 'energy' : 'calm');

export const loadProfile = (): AppProfile | null => {
  try {
    const rawProfile = localStorage.getItem(PROFILE_KEY);
    if (!rawProfile) return null;

    const parsed = JSON.parse(rawProfile) as Partial<AppProfile>;
    if (!parsed?.name || typeof parsed.name !== 'string' || !Number.isFinite(Number(parsed.age))) {
      return null;
    }

    return {
      ...parsed,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'کاربر',
      age: Number(parsed.age),
      personality: normalizePersonality(parsed.personality)
    };
  } catch (err) {
    console.error('[profile] Failed to load profile:', err);
    return null;
  }
};

function ChatApp() {
  const [profile, setProfile] = useState<AppProfile | null>(() => (typeof window === 'undefined' ? null : loadProfile()));
  const [landingStep, setLandingStep] = useState<LandingStep>('landing');
  const [currentView, setCurrentView] = useState<AppView>(() =>
    typeof window === 'undefined' ? 'home' : getAppViewFromPath(window.location.pathname)
  );
  const [hasCheckedSession, setHasCheckedSession] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [authTransition, setAuthTransition] = useState<'forward' | 'back'>('forward');
  const [hasSavedAccount, setHasSavedAccount] = useState(false);

  const [registrationStep, setRegistrationStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; age?: string; phone?: string; code?: string }>({});

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [hasHydratedRemoteConversations, setHasHydratedRemoteConversations] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname === '/home';
  });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsAuthModal, setShowSettingsAuthModal] = useState(false);
  const [profileFormName, setProfileFormName] = useState('');
  const [profileFormAge, setProfileFormAge] = useState('');
  const [profileFormErrors, setProfileFormErrors] = useState<{ name?: string; age?: string }>({});
  const [theme, setTheme] = useState<'energy' | 'calm'>('energy');
  const { pushToast } = useToast();

  const [inputValue, setInputValue] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
 const [isSending, setIsSending] = useState(false);
 const [waitingTextIndex, setWaitingTextIndex] = useState(0);
 const [isRecording, setIsRecording] = useState(false);
 const [showImageGenModal, setShowImageGenModal] = useState(false);
 const [showMessageLimitModal, setShowMessageLimitModal] = useState(false);
 const [showGuestLimitModal, setShowGuestLimitModal] = useState(false);
 const [guestLimitInfo, setGuestLimitInfo] = useState<GuestLimitInfo | null>(null);
 const [returnToChatAfterAuth, setReturnToChatAfterAuth] = useState(false);
 const [imageGenPrompt, setImageGenPrompt] = useState('');
 const [isGeneratingImage, setIsGeneratingImage] = useState(false);
 const [imageGenStatus, setImageGenStatus] = useState<string>('');
 const [imageGenError, setImageGenError] = useState<string>('');
 const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
 const [publicSettings, setPublicSettings] = useState<PublicSettings>(PUBLIC_SETTINGS_DEFAULTS);

 const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Detect stale session: logged in but missing JWT token (from before the token-save fix)
  const hasAuthToken = (() => {
    try { return !!localStorage.getItem('chat_auth_token'); } catch { return false; }
  })();

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordingActionRef = useRef<RecordingAction>('idle');
  const transcriptRef = useRef('');
  const keepRecordingRef = useRef(false);
  const sendMessageRef = useRef<(value?: string) => Promise<void>>(async () => {});
  const sendInFlightRef = useRef(false);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const botMessageRef = useRef<HTMLDivElement | null>(null);
  const prevIsSendingRef = useRef(false);
  const messagesContainerRef = useRef<HTMLElement | null>(null);
  const inputAreaRef = useRef<HTMLElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentBoxRef = useRef<HTMLDivElement | null>(null);
  const attachmentUrlsRef = useRef<Set<string>>(new Set());
  const imageTaskPollingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!imagePreview) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImagePreview(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview]);

  useEffect(() => {
    let cancelled = false;
    const loadPublicSettings = async () => {
      try {
        const response = await safeFetch('/api/settings/public');
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || !payload?.settings || typeof payload.settings !== 'object') return;
        setPublicSettings({
          ...PUBLIC_SETTINGS_DEFAULTS,
          ...payload.settings
        });
      } catch {
        // Keep bundled defaults when settings are unavailable.
      }
    };

    void loadPublicSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );
  const visibleMessages = useMemo(
    () => dedupeChatMessages(activeConversation?.messages || []),
    [activeConversation?.messages]
  );

  const orderedConversations = useMemo(() => sortConversations(conversations), [conversations]);
  const lastAssistantMessageIndex = useMemo(
    () => visibleMessages.map((item) => item.role).lastIndexOf('assistant'),
    [visibleMessages]
  );
  const uploadMaxFiles = Number.isFinite(Number(publicSettings['upload.image.max_files']))
    ? Number(publicSettings['upload.image.max_files'])
    : MAX_ATTACHMENT_COUNT;
  const uploadMaxSizeMb = Number.isFinite(Number(publicSettings['upload.image.max_size_mb']))
    ? Number(publicSettings['upload.image.max_size_mb'])
    : 5;
  const uploadMaxSizeBytes = uploadMaxSizeMb * 1024 * 1024;
  const allowedImageTypes = useMemo(
    () =>
      new Set(
        Array.isArray(publicSettings['upload.image.allowed_types']) && publicSettings['upload.image.allowed_types'].length > 0
          ? publicSettings['upload.image.allowed_types']
          : Array.from(ALLOWED_IMAGE_TYPES)
      ),
    [publicSettings]
  );
  const imageAccept = useMemo(() => {
    const extensions = Array.from(allowedImageTypes).flatMap((type) => {
      if (type === 'image/jpeg') return ['.jpg', '.jpeg', type];
      if (type === 'image/png') return ['.png', type];
      if (type === 'image/webp') return ['.webp', type];
      return [type];
    });
    return extensions.join(',');
  }, [allowedImageTypes]);
  const ageMin = Number.isFinite(Number(publicSettings['auth.validation.age_min']))
    ? Number(publicSettings['auth.validation.age_min'])
    : 8;
  const renderBotAvatar = () => (
    <span className="bot-avatar" aria-hidden="true">
      <img
        src={defaultBotAvatar || BOT_AVATAR_FALLBACK_URL}
        alt="پروفایل ربات"
        loading="lazy"
        decoding="async"
        onError={(event) => {
          const imageElement = event.currentTarget;
          if (imageElement.src.endsWith(BOT_AVATAR_FALLBACK_URL)) return;
          imageElement.src = BOT_AVATAR_FALLBACK_URL;
        }}
      />
    </span>
  );

  const applyTheme = (newTheme: 'energy' | 'calm', persist = true) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', newTheme);
    if (newTheme === 'calm') root.classList.add('theme-calm');
    else root.classList.remove('theme-calm');
    if (persist) {
      localStorage.setItem(THEME_KEY, newTheme);
    }
    setTheme(newTheme);
  };

  const navigateToView = (view: AppView, mode: 'push' | 'replace' = 'push') => {
    const nextPath = view === 'home' ? '/home' : view === 'generate' ? '/generate' : view === 'profile' ? '/profile' : '/chat';
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      if (mode === 'replace') {
        window.history.replaceState({}, '', nextPath);
      } else {
        window.history.pushState({}, '', nextPath);
      }
    }
    setCurrentView(view);
    setSidebarOpen(view === 'home');
  };

  const handleBackToHome = () => {
    navigateToView('home');
  };

  const handleViewPlans = () => {
    setShowMessageLimitModal(false);
    window.location.href = '/plans';
  };

  const handleRemindMessageLimitLater = () => {
    setShowMessageLimitModal(false);
  };

  const handleGuestSignupRequired = () => {
    setShowGuestLimitModal(false);
    setReturnToChatAfterAuth(true);
    beginAuthFlow('signup');
    setErrors({});
    setVerificationCode('');
    setSignupToken('');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/chat');
    }
    setShowSettingsAuthModal(true);
  };

  const handleOpenGuestAuth = () => {
    setReturnToChatAfterAuth(true);
    beginAuthFlow('signup');
    setErrors({});
    setVerificationCode('');
    setSignupToken('');
    setShowProfileModal(false);
    setShowSettingsAuthModal(true);
  };

  const startGuestSession = () => {
    setReturnToChatAfterAuth(false);
    const guestProfile = createGuestProfile();
    setProfile(guestProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(guestProfile));
    sessionStorage.setItem(GUEST_PROFILE_KEY, '1');
    setLandingStep('chat');
    setCurrentView('chat');
    setSidebarOpen(false);
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/chat');
    }
  };

  const beginAuthFlow = (mode: AuthMode) => {
    setAuthTransition('forward');
    setAuthMode(mode);
    setRegistrationStep(1);
    setLandingStep(mode);
    setErrors({});
    setVerificationCode('');
    setSignupToken('');
  };

  const resetAuthFlow = (mode: AuthMode) => {
    setAuthTransition('forward');
    setAuthMode(mode);
    setRegistrationStep(1);
    setLandingStep(mode);
    setErrors({});
    setName('');
    setAge('');
    setVerificationCode('');
    setSignupToken('');
  };

  const handleOpenSettings = () => {
    if (isGuestProfile(profile)) {
      setReturnToChatAfterAuth(false);
      resetAuthFlow('login');
      setShowProfileModal(false);
      setShowSettingsAuthModal(true);
      return;
    }

    navigateToView('profile');
  };

  const releaseMicStream = () => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  };

  const getSupportedRecordingMimeType = () => {
    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      return '';
    }

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/wav'
    ];

    return candidates.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
  };

  const requestMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('MEDIA_DEVICES_UNSUPPORTED');
    }

    releaseMicStream();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    const supportedMimeType = getSupportedRecordingMimeType();
    console.info('[voice-recording] microphone permission granted', {
      supportedMimeType: supportedMimeType || 'speech-recognition-only',
      userAgent: navigator.userAgent
    });
  };

  useEffect(() => {
    try {
      const authParam = new URLSearchParams(window.location.search).get('auth');
      const requestedAuthMode: AuthMode | null = authParam === 'login' || authParam === 'signup' ? authParam : null;
      const rawProfiles = localStorage.getItem(PROFILES_KEY);
      const rawConversations = localStorage.getItem(CONVERSATIONS_KEY);
      const savedActiveConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);

      if (rawProfiles) {
        const parsedProfiles = JSON.parse(rawProfiles) as AppProfile[];
        if (Array.isArray(parsedProfiles) && parsedProfiles.length > 0) {
          setHasSavedAccount(true);
        }
      }

      const profileData = loadProfile();
      const routeView = getAppViewFromPath(window.location.pathname);
      const savedTheme = localStorage.getItem(THEME_KEY) as 'energy' | 'calm' | null;
      if (savedTheme === 'energy' || savedTheme === 'calm') {
        applyTheme(savedTheme, false);
      } else if (profileData) {
        const defaultTheme = getDefaultThemeByAge(profileData.age);
        applyTheme(defaultTheme, false);
      } else {
        applyTheme('energy', false);
      }

      if (profileData) {
        setProfile(profileData);
        setLandingStep('chat');
        setCurrentView(routeView);
        setSidebarOpen(routeView === 'home');
        setHasSavedAccount(true);
      } else if (requestedAuthMode === 'login') {
        setAuthMode('login');
        setRegistrationStep(1);
        setLandingStep('login');
      } else if (requestedAuthMode === 'signup') {
        setAuthMode('signup');
        setRegistrationStep(1);
        setLandingStep('signup');
      } else if (
        window.location.pathname === '/chat' ||
        window.location.pathname === '/generate' ||
        window.location.pathname === '/photos' ||
        window.location.pathname === '/profile' ||
        window.location.pathname === '/settings'
      ) {
        const guestProfile = createGuestProfile();
        setProfile(guestProfile);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(guestProfile));
        sessionStorage.setItem(GUEST_PROFILE_KEY, '1');
        setLandingStep('chat');
        setCurrentView(routeView);
        setSidebarOpen(false);
      } else {
        if (window.location.pathname === '/home') {
          window.location.replace('/');
          return;
        }
        setLandingStep('landing');
      }

      if (rawConversations) {
        const parsedConversations = JSON.parse(rawConversations) as Conversation[];
        if (parsedConversations.length > 0) {
          const sorted = sortConversations(
            parsedConversations.map((conversation) => ({
              ...conversation,
              messages: dedupeChatMessages(Array.isArray(conversation.messages) ? conversation.messages : [])
            }))
          );
          setConversations(sorted);
          const validActiveConversation =
            savedActiveConversationId && sorted.some((item) => item.id === savedActiveConversationId)
              ? savedActiveConversationId
              : sorted[0].id;
          setActiveConversationId(validActiveConversation);
          return;
        }
      }

      setConversations([]);
      setActiveConversationId('');
    } catch {
      setConversations([]);
      setActiveConversationId('');
    } finally {
      setHasCheckedSession(true);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const pathname = window.location.pathname;
      if (pathname === '/home' || pathname === '/chat' || pathname === '/generate' || pathname === '/photos' || pathname === '/profile' || pathname === '/settings') {
        const nextView = getAppViewFromPath(pathname);
        setCurrentView(nextView);
        setSidebarOpen(nextView === 'home');
        if (!loadProfile() && !new URLSearchParams(window.location.search).get('auth')) {
          window.location.replace('/');
        }
        return;
      }

      window.location.href = pathname || '/';
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!profile?.id || landingStep !== 'chat') {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const payload = await loadRemoteConversations(profile);
        if (cancelled) return;

        const remote = Array.isArray(payload.items) ? payload.items.map(normalizeConversationFromServer) : [];
        if (remote.length === 0) {
          setHasHydratedRemoteConversations(true);
          return;
        }

        const sorted = sortConversations(remote);
        setConversations(sorted);
        const nextActiveId = sorted[0].id;
        setActiveConversationId(nextActiveId);
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(sorted));
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, nextActiveId);
        setHasHydratedRemoteConversations(true);
      } catch (error) {
        // Keep local data if remote load fails.
        console.error('[conversations] Remote load failed, keeping local data:', error);
      } finally {
        setHasHydratedRemoteConversations(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, landingStep]);

  useEffect(() => {
    if (profile) {
      setLandingStep('chat');
    }
  }, [profile]);

  useEffect(() => {
    if (!profile || (!showProfileModal && currentView !== 'profile')) {
      return;
    }

    let nextProfile = profile;
    if (!profile.id) {
      nextProfile = { ...profile, id: generateUniqueId() };
      setProfile(nextProfile);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    }

    setProfileFormName(nextProfile.name);
    setProfileFormAge(String(nextProfile.age));
    setProfileFormErrors({});
  }, [profile, showProfileModal, currentView]);

  useEffect(() => {
    if (conversations.length > 0) {
      const normalized = conversations.map((conversation) => ({
        ...conversation,
        messages: dedupeChatMessages(Array.isArray(conversation.messages) ? conversation.messages : [])
      }));
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(normalized));
    }
  }, [conversations]);

  useEffect(() => {
    if (!profile?.id || landingStep !== 'chat' || conversations.length === 0 || !hasHydratedRemoteConversations) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void syncRemoteConversations(profile, conversations);
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [profile, conversations, landingStep, hasHydratedRemoteConversations]);

  useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!isSending) {
      setWaitingTextIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setWaitingTextIndex((prev) => (prev + 1) % WAITING_MESSAGES.length);
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSending]);

  useEffect(() => {
    if (!attachmentMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (attachmentBoxRef.current?.contains(event.target as Node)) {
        return;
      }
      setAttachmentMenuOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [attachmentMenuOpen]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const runScroll = () => {
      const justReceivedBotReply =
        prevIsSendingRef.current &&
        !isSending &&
        visibleMessages[lastAssistantMessageIndex]?.role === 'assistant';

      if (justReceivedBotReply) {
        botMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        inputAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        prevIsSendingRef.current = isSending;
        return;
      }

      container.scrollTo({
        top: container.scrollHeight + 24,
        behavior: 'smooth'
      });
      lastMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      inputAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      prevIsSendingRef.current = isSending;
    };

    const frameId = window.requestAnimationFrame(() => {
      window.setTimeout(runScroll, 50);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeConversationId, visibleMessages.length, isSending, lastAssistantMessageIndex, visibleMessages]);

  useEffect(() => {
    const SpeechRecognitionApi = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      return;
    }

    const recognition = new SpeechRecognitionApi();
    recognition.lang = 'fa-IR';
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = (event as any).resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          transcriptRef.current += result[0].transcript;
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[voice-recording] speech recognition error', {
        error: event.error,
        message: event.message,
        userAgent: navigator.userAgent
      });
      if (event.error === 'aborted' && recordingActionRef.current !== 'idle') {
        return;
      }
      keepRecordingRef.current = false;
      recordingActionRef.current = 'cancel';
      setIsRecording(false);
      releaseMicStream();
      pushToast(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'اجازه دسترسی به میکروفن داده نشد. لطفاً دسترسی میکروفن را در مرورگر فعال کن.'
          : 'دسترسی به میکروفن برقرار نشد. لطفاً دوباره تلاش کن.',
        'danger'
      );
    };

    recognition.onend = () => {
      if (recordingActionRef.current === 'idle' && keepRecordingRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          keepRecordingRef.current = false;
          setIsRecording(false);
          pushToast('ضبط برای مدت طولانی ادامه پیدا نکرد. لطفاً دوباره تلاش کن.', 'warning');
          return;
        }
      }

      const action = recordingActionRef.current;
      const transcript = transcriptRef.current.trim();
      keepRecordingRef.current = false;
      recordingActionRef.current = 'idle';
      setIsRecording(false);
      releaseMicStream();

      if (action === 'confirm' && transcript) {
        setInputValue(transcript);
        void sendMessageRef.current(transcript);
      }

      if (action === 'cancel') {
        transcriptRef.current = '';
        setInputValue('');
      }
    };

    recognitionRef.current = recognition;

    return () => {
      keepRecordingRef.current = false;
      recognition.stop();
      releaseMicStream();
      recognitionRef.current = null;
    };
  }, [pushToast]);

  const updateConversation = (conversationId: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((prev) =>
      prev.map((item) => {
        if (item.id !== conversationId) {
          return item;
        }
        const next = updater(item);
        return {
          ...next,
          messages: dedupeChatMessages(Array.isArray(next.messages) ? next.messages : [])
        };
      })
    );
  };

  const ensureConversation = (): Conversation => {
    if (activeConversation) {
      return activeConversation;
    }

    const created = createConversation();
    setConversations((prev) => [created, ...prev]);
    setActiveConversationId(created.id);
    return created;
  };

  const ensureConversationFromBackend = async (): Promise<Conversation> => {
    if (activeConversation && CONVERSATION_UUID_PATTERN.test(activeConversation.id)) {
      return activeConversation;
    }
    if (!profile) {
      return ensureConversation();
    }
    try {
      const created = await createRemoteConversation(profile);
      setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setActiveConversationId(created.id);
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, created.id);
      return created;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'ساخت گفتگوی جدید انجام نشد.', 'warning');
      return ensureConversation();
    }
  };

  const updateImageTaskMessage = (
    conversationId: string,
    taskId: string,
    patch: Partial<ChatMessage>
  ) => {
    updateConversation(conversationId, (item) => {
      let foundTaskMessage = false;
      const messages = item.messages.map((message) => {
        if (String(message.taskId || '') !== String(taskId)) {
          return message;
        }

        foundTaskMessage = true;
        return {
          ...message,
          ...patch,
          taskId: String(taskId)
        };
      });

      if (
        !foundTaskMessage &&
        (patch.type === 'image_result' || patch.type === 'image_error' || patch.type === 'image_loading')
      ) {
        messages.push({
          id: `image-task-${taskId}`,
          role: 'assistant',
          type: patch.type,
          intent: patch.intent || 'image_generation',
          content: patch.content || (patch.type === 'image_result' ? 'تصویر آماده شد.' : 'در حال ساخت تصویر...'),
          timestamp: new Date().toISOString(),
          taskId: String(taskId),
          status: patch.status,
          images: patch.images
        });
      }

      return {
        ...item,
        messages: dedupeChatMessages(messages),
        updatedAt: new Date().toISOString()
      };
    });
  };

  const pollImageTask = async (conversationId: string, taskId: string, prompt = 'تصویر ساخته شده') => {
    const key = `${conversationId}:${taskId}`;
    if (!taskId || imageTaskPollingRef.current.has(key)) {
      return;
    }
    imageTaskPollingRef.current.add(key);

    const maxPolls = 90;
    try {
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const { status, imageUrl, error } = await getImageGenerationStatusForConversation(taskId, conversationId);

        if (status === 'COMPLETED' && imageUrl) {
          updateImageTaskMessage(conversationId, taskId, {
            type: 'image_result',
            content: 'تصویر آماده شد.',
            status: 'COMPLETED',
            images: [{ url: imageUrl, alt: prompt }]
          });
          pushToast('عکس با موفقیت ساخته شد', 'success');
          return;
        }

        if (status === 'ERROR') {
          const errorMessage = error || 'ساخت تصویر انجام نشد. مشکل از سرویس تصویر بود، نه درخواست تو. دوباره امتحان کن.';
          updateImageTaskMessage(conversationId, taskId, {
            type: 'image_error',
            content: errorMessage,
            status: 'ERROR',
            images: undefined
          });
          pushToast(errorMessage, 'danger');
          return;
        }

        updateImageTaskMessage(conversationId, taskId, {
          type: 'image_loading',
          content: status === 'QUEUE' || status === 'WAITING' ? 'در صف ساخت تصویر...' : 'در حال ساخت تصویر...',
          status
        });
        await wait(2000);
      }

      updateImageTaskMessage(conversationId, taskId, {
        type: 'image_error',
        content: 'ساخت تصویر بیش از حد طول کشید. دوباره امتحان کن.',
        status: 'ERROR'
      });
    } finally {
      imageTaskPollingRef.current.delete(key);
    }
  };

  useEffect(() => {
    for (const conversation of conversations) {
      conversation.messages.forEach((message, index) => {
        const taskId = getMessageTaskId(message);
        const isPendingImageTask =
          message.role === 'assistant' &&
          Boolean(taskId) &&
          (message.type === 'image_loading' ||
            (message.intent === 'image_generation' && message.status !== 'COMPLETED' && message.status !== 'ERROR') ||
            (message.intent === 'image_edit' && message.status !== 'COMPLETED' && message.status !== 'ERROR'));
        if (!isPendingImageTask) {
          return;
        }
        const prompt =
          [...conversation.messages.slice(0, index)]
            .reverse()
            .find((item) => item.role === 'user' && item.content.trim())?.content || 'تصویر ساخته شده';
        void pollImageTask(conversation.id, taskId, prompt);
      });
    }
  }, [conversations]);

  const saveAuthenticatedProfile = (nextProfile: AppProfile, token?: string) => {
    const normalizedPhone = typeof nextProfile.phone === 'string' ? normalizePhoneInput(nextProfile.phone) : '';
    const shouldReturnToSettings = showSettingsAuthModal && !returnToChatAfterAuth;

    if (token) {
      localStorage.setItem('chat_auth_token', token);
    }

    setHasHydratedRemoteConversations(false);
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    sessionStorage.removeItem(GUEST_PROFILE_KEY);

    const rawProfiles = localStorage.getItem(PROFILES_KEY);
    const parsedProfiles = rawProfiles ? (JSON.parse(rawProfiles) as AppProfile[]) : [];
    const profiles = Array.isArray(parsedProfiles) ? parsedProfiles : [];
    const withoutSamePhone = profiles.filter((item) => {
      const savedPhone = typeof item?.phone === 'string' ? normalizePhoneInput(item.phone) : '';
      return savedPhone !== normalizedPhone;
    });
    localStorage.setItem(PROFILES_KEY, JSON.stringify([...withoutSamePhone, nextProfile]));
    setHasSavedAccount(true);
    setLandingStep('chat');
    if (returnToChatAfterAuth) {
      setShowSettingsAuthModal(false);
      setReturnToChatAfterAuth(false);
      setGuestLimitInfo(null);
      navigateToView('chat', 'replace');
      return;
    }
    if (shouldReturnToSettings) {
      setShowSettingsAuthModal(false);
      setShowProfileModal(true);
      return;
    }

    navigateToView('chat', 'replace');
  };

  const handleRegisterStepOne = async (event: FormEvent) => {
    event.preventDefault();

    const normalizedPhone = normalizePhoneInput(phone);
    const nextErrors: { phone?: string } = {};

    if (!PERSIAN_PHONE_REGEX.test(normalizedPhone)) {
      nextErrors.phone = 'شماره والد باید با 09 شروع شود و 11 رقم باشد.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setPhone(normalizedPhone);
    setSignupToken('');
    setIsSendingVerification(true);
    setIsCheckingPhone(true);

    try {
      const phoneStatus = await checkPhoneStatus(normalizedPhone, authMode);
      const nextAuthMode = phoneStatus.recommendedMode || authMode;
      setAuthMode(nextAuthMode);
      setLandingStep(nextAuthMode);
      await sendVerificationCode(normalizedPhone, nextAuthMode);

      setVerificationCode('');
      setErrors({});
      setRegistrationStep(2);
    } catch (error) {
      setErrors({
        phone:
          error instanceof Error && error.message.trim()
            ? error.message
            : 'ارسال کد تایید با خطا مواجه شد. لطفاً دوباره تلاش کن.'
      });
    } finally {
      setIsCheckingPhone(false);
      setIsSendingVerification(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent) => {
    event.preventDefault();

    const normalizedPhone = normalizePhoneInput(phone);
    const trimmedCode = verificationCode.trim();
    const nextErrors: { code?: string } = {};

    const normalizedCode = normalizeLocalizedDigits(trimmedCode).replace(/\D/g, '');

    if (!/^[0-9]{4,6}$/.test(normalizedCode)) {
      nextErrors.code = 'کد تایید باید 4 تا 6 رقم باشد.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsVerifyingCode(true);

    try {
      const verificationResult = await verifyCode(normalizedPhone, normalizedCode, authMode);

      if (verificationResult.requiresProfile === false && verificationResult.profile && verificationResult.userId) {
        const normalizedProfile: AppProfile = {
          name: verificationResult.profile.name,
          age: Number(verificationResult.profile.age),
          phone: verificationResult.profile.phone,
          id: verificationResult.userId,
          personality: createDefaultPersonality()
        };

        saveAuthenticatedProfile(normalizedProfile, verificationResult.token);
        return;
      }

      setSignupToken(verificationResult.signupToken || '');
      setName('');
      setAge('');
      setErrors({});
      setRegistrationStep(3);
    } catch (error) {
      const redirectTo = error && typeof error === 'object' ? (error as ApiError).redirectTo : null;
      if (redirectTo) {
        setAuthTransition('forward');
        setAuthMode(redirectTo);
        setLandingStep(redirectTo);
        setRegistrationStep(1);
      }
      setErrors({
        code: error instanceof Error && error.message.trim() ? error.message : 'کد نادرست است'
      });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleCompleteProfile = async (event: FormEvent) => {
    event.preventDefault();

    const normalizedPhone = normalizePhoneInput(phone);
    const numericAge = parseAgeInput(age);
    const nextErrors: { name?: string; age?: string } = {};

    if (!name.trim()) {
      nextErrors.name = 'اسم کودک را بنویس تا با هم آشنا شویم.';
    }

    if (!age || Number.isNaN(numericAge) || numericAge < ageMin) {
      nextErrors.age = `سن باید حداقل ${ageMin} سال باشد.`;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsVerifyingCode(true);
    try {
      const registrationResult = await registerProfile({
        name: name.trim(),
        age: normalizeLocalizedDigits(age.trim()),
        phone: normalizedPhone,
        mode: 'signup',
        signupToken
      });

      saveAuthenticatedProfile(
        {
          name: registrationResult.profile.name,
          age: Number(registrationResult.profile.age),
          phone: registrationResult.profile.phone,
          id: registrationResult.userId,
          personality: createDefaultPersonality()
        },
        registrationResult.token
      );
    } catch (error) {
      setErrors({
        name: error instanceof Error && error.message.trim() ? error.message : 'ثبت پروفایل انجام نشد.'
      });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleSendMessage = async (value?: string) => {
    if (!profile || isSending || sendInFlightRef.current) {
      return;
    }

    const content = (value ?? inputValue).trim();
    const attachmentsAtSend = [...attachments];
    const sentAttachmentIds = new Set(attachmentsAtSend.map((item) => item.id));
    const hasAttachments = attachmentsAtSend.length > 0;
    if (!content && !hasAttachments) {
      return;
    }
    sendInFlightRef.current = true;

    const effectiveUserText = content || 'لطفاً محتوای عکس را توضیح بده.';
    const nextPersonality = updatePersonalityFromMessage(normalizePersonality(profile.personality), effectiveUserText);
    const nextProfile: AppProfile = {
      ...profile,
      personality: nextPersonality
    };
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));

    const currentConversation = await ensureConversationFromBackend();
    const previewImages = attachmentsAtSend.map((attachment, index) => ({
      url: attachment.previewUrl,
      alt: attachment.file.name || `تصویر ارسال شده ${index + 1}`
    }));
    const userMessage: ChatMessage = {
      id: generateMessageId('user'),
      role: 'user',
      type: 'text',
      content: content || '📷 عکس ارسال شد',
      timestamp: new Date().toISOString(),
      images: previewImages.length > 0 ? previewImages : undefined
    };

    const updatedMessages = [...currentConversation.messages, userMessage];
    const nextTitle =
      currentConversation.title === DEFAULT_TITLE && currentConversation.messages.length === 0
        ? inferTitle(content || 'عکس')
        : currentConversation.title;

    updateConversation(currentConversation.id, (item) => ({
      ...item,
      title: nextTitle,
      messages: updatedMessages,
      updatedAt: new Date().toISOString()
    }));

    setInputValue('');
    if (sentAttachmentIds.size > 0) {
      setAttachments((prev) => prev.filter((item) => !sentAttachmentIds.has(item.id)));
    }
    setIsSending(true);

    try {
      const uploadedImageIds = attachmentsAtSend
        .filter((item) => item.status === 'uploaded' && typeof item.imageId === 'string' && item.imageId.trim().length > 0)
        .map((item) => String(item.imageId));
      const pendingOrErrorAttachments = attachmentsAtSend.filter((item) => item.status === 'pending' || item.status === 'error');
      if (pendingOrErrorAttachments.length > 0) {
        const formData = new FormData();
        pendingOrErrorAttachments.forEach((attachment) => {
          formData.append('images', attachment.file);
        });

        let uploadResponse: Response;
        let uploadData: any = {};
        try {
          uploadResponse = await safeFetch('/api/uploads/images', {
            method: 'POST',
            credentials: 'include',
            headers: {
              ...(localStorage.getItem('chat_auth_token')
                ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
                : {})
            },
            body: formData
          });
          uploadData = await uploadResponse.json();
        } catch (_uploadNetworkError) {
          setAttachments((prev) => [
            ...pendingOrErrorAttachments.map((item) => ({
              ...item,
              status: 'error' as AttachmentStatus,
              error: 'آپلود تصویر با خطا مواجه شد.'
            })),
            ...prev
          ]);
          pushToast('آپلود تصویر ناموفق: خطای شبکه', 'danger');
          return;
        }

        if (!uploadResponse.ok) {
          const uploadError = uploadData?.message || uploadData?.error || 'آپلود تصویر ناموفق بود.';
          setAttachments((prev) => [
            ...pendingOrErrorAttachments.map((item) => ({
              ...item,
              status: 'error' as AttachmentStatus,
              error: String(uploadError)
            })),
            ...prev
          ]);
          pushToast(`آپلود تصویر ناموفق: ${String(uploadError)}`, 'danger');
          return;
        }

        const uploadedItems = Array.isArray(uploadData?.images) ? uploadData.images : [];
        const nextUploadedImageIds = uploadedItems
          .slice(0, pendingOrErrorAttachments.length)
          .map((item: { imageId?: unknown }) => (typeof item?.imageId === 'string' ? item.imageId.trim() : ''));

        if (
          nextUploadedImageIds.length !== pendingOrErrorAttachments.length ||
          nextUploadedImageIds.some((imageId: string) => !imageId)
        ) {
          setAttachments((prev) => [
            ...pendingOrErrorAttachments.map((item) => ({
              ...item,
              status: 'error' as AttachmentStatus,
              error: 'imageId دریافت نشد.'
            })),
            ...prev
          ]);
          pushToast('آپلود تصویر ناموفق: شناسه تصویر دریافت نشد.', 'danger');
          return;
        }

        uploadedImageIds.push(...nextUploadedImageIds);
      }

      if (uploadedImageIds.length > 0) {
        const messageImages = uploadedImageIds.map((imageId, index) => ({
          url: `/api/uploads/images/${imageId}`,
          alt: `تصویر ارسال شده ${index + 1}`
        }));
        updateConversation(currentConversation.id, (item) => ({
          ...item,
          messages: item.messages.map((message) =>
            message.role === 'user' && message.timestamp === userMessage.timestamp
              ? { ...message, images: messageImages }
              : message
          ),
          updatedAt: new Date().toISOString()
        }));
        attachmentsAtSend.forEach((attachment) => {
          URL.revokeObjectURL(attachment.previewUrl);
          attachmentUrlsRef.current.delete(attachment.previewUrl);
        });
      }

      const response = await postChatWithRetry({
        message: content,
        imageIds: uploadedImageIds,
        profile: nextProfile,
        personality: nextPersonality,
        conversationId: currentConversation.id,
        clientMessageId: userMessage.id
      });

      if (!response.ok) {
        const payload = await parseApiError(response);
        const message =
          payload.error?.trim() ||
          payload.message?.trim() ||
          (response.status === 401 || response.status === 403
            ? 'احراز هویت API نامعتبر است. لطفاً کلید API را در بک اند بررسی کن.'
            : 'پاسخ سرور دریافت نشد.');
        throw createChatRequestError(message, response.status, payload);
      }

      const data = (await response.json()) as ChatImageIntentResponse;
      if (
        data.intent === 'image_generation' ||
        data.intent === 'image_edit'
      ) {
        const imageTaskId = typeof data.taskId === 'string' || typeof data.taskId === 'number' ? String(data.taskId).trim() : '';
        const responseMessages = Array.isArray(data.messages) ? data.messages : [];
        if (responseMessages.length > 0) {
          updateConversation(currentConversation.id, (item) => {
            const optimisticIds = new Set([userMessage.id].filter(Boolean));
            const withoutOptimistic = item.messages.filter((message) => !message.id || !optimisticIds.has(message.id));
            const existingIds = new Set(withoutOptimistic.map((message) => message.id).filter(Boolean));
            const canonicalMessages = responseMessages.filter((message) => !message.id || !existingIds.has(message.id));
            return {
              ...item,
              messages: dedupeChatMessages([...withoutOptimistic, ...canonicalMessages]),
              updatedAt: new Date().toISOString()
            };
          });
        } else {
          const assistantText = data.assistantText || 'باشه، دارم تصویرت رو می‌سازم...';
          const assistantMessage: ChatMessage = {
            id: generateMessageId('assistant-image'),
            role: 'assistant',
            type: data.status === 'ERROR' ? 'image_error' : imageTaskId ? 'image_loading' : 'text',
            intent: data.intent,
            content: assistantText,
            timestamp: new Date().toISOString(),
            status: data.status,
            taskId: imageTaskId || undefined
          };
          updateConversation(currentConversation.id, (item) => ({
            ...item,
            messages: dedupeChatMessages([...item.messages, assistantMessage]),
            updatedAt: new Date().toISOString()
          }));
        }

        if (data.status === 'ERROR') {
          pushToast(data.assistantText || 'ساخت عکس ناموفق بود', 'warning');
        } else if (imageTaskId) {
          updateImageTaskMessage(currentConversation.id, imageTaskId, {
            type: 'image_loading',
            intent: data.intent,
            content: data.assistantText || 'درخواست ساخت تصویر ثبت شد. در حال ساخت تصویر...',
            status: data.status || 'QUEUE',
            taskId: imageTaskId
          });
          void pollImageTask(currentConversation.id, imageTaskId, content || 'تصویر ساخته شده');
          pushToast('درخواست ساخت تصویر ثبت شد', 'success');
        }
        return;
      }

      if (data.intent === 'image_understanding') {
        const responseMessages = Array.isArray(data.messages) ? data.messages : [];
        if (responseMessages.length > 0) {
          updateConversation(currentConversation.id, (item) => {
            const optimisticIds = new Set([userMessage.id].filter(Boolean));
            const withoutOptimistic = item.messages.filter((message) => !message.id || !optimisticIds.has(message.id));
            const existingIds = new Set(withoutOptimistic.map((message) => message.id).filter(Boolean));
            const canonicalMessages = responseMessages.filter((message) => !message.id || !existingIds.has(message.id));
            return {
              ...item,
              messages: dedupeChatMessages([...withoutOptimistic, ...canonicalMessages]),
              updatedAt: new Date().toISOString()
            };
          });
        } else {
          const replyText = data.reply?.trim() || data.assistantText?.trim() || 'الان نتوانستم تصویر را درست بخوانم. لطفاً دوباره امتحان کن.';
          const botMessage: ChatMessage = {
            id: generateMessageId('assistant-vision'),
            role: 'assistant',
            type: 'text',
            intent: 'image_understanding',
            content: replyText,
            timestamp: new Date().toISOString()
          };
          updateConversation(currentConversation.id, (item) => ({
            ...item,
            messages: [...item.messages, botMessage],
            updatedAt: new Date().toISOString()
          }));
        }
        if (data.status === 'ERROR') {
          pushToast(data.assistantText || 'خواندن تصویر ناموفق بود', 'warning');
        }
        return;
      }

      const replyText = data.reply?.trim() || data.assistantText?.trim() || 'الان نتوانستم پاسخ بدهم. لطفاً دوباره امتحان کن.';

      const botMessage: ChatMessage = {
        id: generateMessageId('assistant'),
        role: 'assistant',
        type: 'text',
        content: replyText,
        timestamp: new Date().toISOString()
      };

      updateConversation(currentConversation.id, (item) => ({
        ...item,
        messages: [...item.messages, botMessage],
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (
        error instanceof Error &&
        (error as ChatRequestError).payload?.error === 'GUEST_LIMIT_REACHED'
      ) {
        const payload = (error as ChatRequestError).payload || {};
        const limit = Number(payload.limit);
        const usage = Number(payload.usage);
        const remaining = Number(payload.remaining);
        setGuestLimitInfo({
          limit: Number.isFinite(limit) && limit > 0 ? limit : Number(PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.badge_text']) || 10,
          usage: Number.isFinite(usage) && usage >= 0 ? usage : Number.isFinite(limit) && limit > 0 ? limit : 10,
          remaining: Number.isFinite(remaining) && remaining >= 0 ? remaining : 0
        });
        updateConversation(currentConversation.id, (item) => {
          const remainingMessages = item.messages.filter((message) => message.timestamp !== userMessage.timestamp);
          return {
            ...item,
            title: item.messages.length === 1 ? DEFAULT_TITLE : item.title,
            messages: remainingMessages,
            updatedAt: new Date().toISOString()
          };
        });
        setInputValue(content);
        setShowGuestLimitModal(true);
        return;
      }

      if (isMessageLimitError(error)) {
        setShowMessageLimitModal(true);
        return;
      }

      const isNetworkError = error instanceof Error && error.message.includes('اتصال به سرور');
      const isTimeoutError = error instanceof Error && error.message.includes('بیش از حد طول کشید');

      let toastType: 'danger' | 'warning' = 'danger';
      if (isNetworkError || isTimeoutError) {
        toastType = 'warning';
      }

      const fallbackText =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'یه مشکل کوچولو پیش اومد. چند لحظه دیگه دوباره تلاش می کنیم.';
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: fallbackText,
        timestamp: new Date().toISOString()
      };

      pushToast(
        isNetworkError ? 'خطای شبکه — لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید' :
        isTimeoutError ? 'درخواست بیش از حد طول کشید. لطفاً دوباره تلاش کنید' :
        'خطا در دریافت پاسخ — لطفاً دوباره تلاش کنید',
        toastType
      );

      updateConversation(currentConversation.id, (item) => ({
        ...item,
        messages: [...item.messages, errorMessage],
        updatedAt: new Date().toISOString()
      }));
    } finally {
      sendInFlightRef.current = false;
      setIsSending(false);
      setAttachmentMenuOpen(false);
    }
  };

  const handlePickImageClick = () => {
    setAttachmentMenuOpen(false);
    imageInputRef.current?.click();
  };

  const handleImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (selectedFiles.length === 0) {
      return;
    }

    const next: ImageAttachment[] = [];
    for (const file of selectedFiles) {
      if (!allowedImageTypes.has(file.type)) {
        pushToast(`فرمت ${file.name} مجاز نیست.`, 'danger');
        continue;
      }
      if (file.size > uploadMaxSizeBytes) {
        pushToast(`حجم ${file.name} بیشتر از ${new Intl.NumberFormat('fa-IR').format(uploadMaxSizeMb)} مگابایت است.`, 'danger');
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'pending'
      });
    }

    if (next.length === 0) {
      return;
    }

    setAttachments((prev) => {
      const merged = [...prev, ...next];
      if (merged.length > uploadMaxFiles) {
        pushToast(`حداکثر ${new Intl.NumberFormat('fa-IR').format(uploadMaxFiles)} عکس قابل انتخاب است. فقط ${new Intl.NumberFormat('fa-IR').format(uploadMaxFiles)} مورد اول نگه داشته شد.`, 'warning');
      }
      const limited = merged.slice(0, uploadMaxFiles);
      const removed = merged.slice(uploadMaxFiles);
      removed.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        attachmentUrlsRef.current.delete(item.previewUrl);
      });
      limited.forEach((item) => attachmentUrlsRef.current.add(item.previewUrl));
      return limited;
    });
  };

  const handleRemoveImage = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        attachmentUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleRetryUpload = async (id: string) => {
    const attachment = attachments.find((item) => item.id === id);
    if (!attachment) return;

    setAttachments((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'uploading' as AttachmentStatus, error: undefined } : item)));

    try {
      const formData = new FormData();
      formData.append('images', attachment.file);
      const response = await safeFetch('/api/uploads/images', {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(localStorage.getItem('chat_auth_token')
            ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
            : {})
        },
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !Array.isArray(data?.images) || data.images.length === 0) {
        throw new Error(data?.message || data?.error || 'آپلود ناموفق');
      }

      const imageId = data.images[0].imageId;
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: 'uploaded' as AttachmentStatus, imageId } : item
        )
      );
    } catch {
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: 'error' as AttachmentStatus, error: 'آپلود تصویر با خطا مواجه شد.' } : item
        )
      );
      pushToast('آپلود تصویر ناموفق. لطفاً دوباره تلاش کنید.', 'danger');
    }
  };

  useEffect(() => {
    sendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  useEffect(() => {
    return () => {
      attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlsRef.current.clear();
    };
  }, []);

  const handleCreateConversation = async () => {
    if (profile) {
      try {
        const created = await createRemoteConversation(profile);
        setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        setActiveConversationId(created.id);
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, created.id);
      } catch (error) {
        pushToast(error instanceof Error ? error.message : 'ساخت گفتگوی جدید انجام نشد.', 'warning');
        setActiveConversationId('');
      }
    } else {
      setActiveConversationId('');
    }
    setSidebarOpen(false);
    setInputValue('');
    navigateToView('chat');
  };

  const handleDeleteConversation = (conversationId: string) => {
    const target = conversations.find((item) => item.id === conversationId);
    if (!target) {
      return;
    }

    const allowed = window.confirm(`"${target.title}" حذف شود؟`);
    if (!allowed) {
      return;
    }

    const remaining = conversations.filter((item) => item.id !== conversationId);
    if (remaining.length === 0) {
      setConversations([]);
      setActiveConversationId('');
      localStorage.removeItem(CONVERSATIONS_KEY);
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      return;
    }

    const sorted = sortConversations(remaining);
    setConversations(sorted);
    if (activeConversationId === conversationId) {
      setActiveConversationId(sorted[0].id);
    }
  };

  const handleDeleteAllConversations = () => {
    const confirmed = window.confirm('همه گفتگوها حذف شوند؟ این عمل قابل بازگشت نیست.');
    if (!confirmed) {
      return;
    }

    setConversations([]);
    setActiveConversationId('');
    setSidebarOpen(false);
    setInputValue('');
    localStorage.removeItem(CONVERSATIONS_KEY);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    navigateToView('chat');
  };

  const handleDownloadActiveConversation = () => {
    if (!activeConversation) {
      pushToast('گفتگوی فعالی برای ذخیره وجود ندارد.', 'warning');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const exportTime = new Date().toLocaleString('fa-IR');
    const safeTitle = (activeConversation.title || DEFAULT_TITLE).trim();
    const messagesText = activeConversation.messages
      .map((message) => `${message.role === 'user' ? 'شما' : 'دانوآ'}: ${message.content}`)
      .join('\n\n');

    const content = [`عنوان گفتگو: ${safeTitle}`, `تاریخ ذخیره: ${exportTime}`, '', messagesText || 'این گفتگو هنوز پیامی ندارد.'].join(
      '\n'
    );

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `گفتگو-${today}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const handleLogout = () => {
    const confirmed = window.confirm('از حساب خارج می شوی؟ همه اطلاعات گفتگو پاک می شود.');
    if (!confirmed) {
      return;
    }

    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(CONVERSATIONS_KEY);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    localStorage.removeItem('chat_auth_token');

    setProfile(null);
    setLandingStep('landing');
    setAuthMode('signup');
    setRegistrationStep(1);
    setName('');
    setAge('');
    setPhone('');
    setVerificationCode('');
    setErrors({});
    setConversations([]);
    setActiveConversationId('');
    setHasHydratedRemoteConversations(false);
    setSidebarOpen(false);
    setInputValue('');
    setIsSending(false);
    setIsRecording(false);
    setShowGuestLimitModal(false);
    setGuestLimitInfo(null);
    setReturnToChatAfterAuth(false);
    setHasSavedAccount(Boolean(localStorage.getItem(PROFILES_KEY)));
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
      window.location.href = '/';
    }
  };

  const handleStartRecording = async () => {
    if (!recognitionRef.current) {
      console.warn('[voice-recording] speech recognition unsupported', {
        hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
        hasMediaRecorder: typeof window.MediaRecorder !== 'undefined',
        supportedMimeType: getSupportedRecordingMimeType() || null,
        userAgent: navigator.userAgent
      });
      pushToast('مرورگر تو از ضبط صدا پشتیبانی نمی کند.', 'warning');
      return;
    }

    try {
      await requestMicrophoneAccess();
      recordingActionRef.current = 'idle';
      transcriptRef.current = '';
      keepRecordingRef.current = true;
      setIsRecording(true);
      recognitionRef.current.start();
    } catch (error) {
      console.warn('[voice-recording] start failed', {
        name: error instanceof DOMException ? error.name : error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error),
        supportedMimeType: getSupportedRecordingMimeType() || null,
        userAgent: navigator.userAgent
      });
      keepRecordingRef.current = false;
      releaseMicStream();
      setIsRecording(false);
      const message =
        error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
          ? 'اجازه دسترسی به میکروفن داده نشد. لطفاً دسترسی میکروفن را فعال کن.'
          : error instanceof Error && error.message === 'MEDIA_DEVICES_UNSUPPORTED'
            ? 'مرورگر تو دسترسی مستقیم به میکروفن را پشتیبانی نمی کند.'
            : 'فعلاً نتوانستم ضبط را شروع کنم. دوباره امتحان کن.';
      pushToast(message, 'danger');
    }
  };

  const handleConfirmRecording = () => {
    if (!recognitionRef.current) {
      return;
    }
    recordingActionRef.current = 'confirm';
    keepRecordingRef.current = false;
    recognitionRef.current.stop();
  };

  const handleCancelRecording = () => {
   if (!recognitionRef.current) {
     return;
   }
   recordingActionRef.current = 'cancel';
   keepRecordingRef.current = false;
   recognitionRef.current.stop();
   releaseMicStream();
 };

 const handleGenerateImageClick = () => {
   setAttachmentMenuOpen(false);
   setImageGenError('');
   setImageGenStatus('');
   navigateToView('generate');
 };

 const handleCloseImageGenerator = () => {
   setShowImageGenModal(false);
   setImageGenError('');
   setImageGenStatus('');
 };

 const handleGenerateImageSubmit = async () => {
   const prompt = imageGenPrompt.trim();
   if (!prompt) {
     pushToast('لطفاً توضیح عکس را بنویس', 'danger');
     return;
   }
   if (prompt.length < 8) {
     setImageGenError('توضیح تصویر را کمی کامل‌تر بنویس تا نتیجه دقیق‌تر شود.');
     return;
   }

   setIsGeneratingImage(true);
   setImageGenStatus('در حال ثبت درخواست ساخت تصویر...');
   setImageGenError('');
   setShowImageGenModal(false);
   navigateToView('chat');

   try {
     const currentConversation = await ensureConversationFromBackend();
     const userMessage: ChatMessage = {
       id: generateMessageId('user-image-prompt'),
       role: 'user',
       type: 'text',
       intent: 'image_generation',
       content: prompt,
       timestamp: new Date().toISOString()
     };

     const nextTitle =
       currentConversation.title === DEFAULT_TITLE && currentConversation.messages.length === 0
         ? inferTitle(prompt)
         : currentConversation.title;

     updateConversation(currentConversation.id, (item) => ({
       ...item,
       title: nextTitle,
       messages: dedupeChatMessages([...item.messages, userMessage]),
       updatedAt: new Date().toISOString()
     }));

     const { taskId } = await startImageGeneration(prompt);
     updateImageTaskMessage(currentConversation.id, taskId, {
       type: 'image_loading',
       intent: 'image_generation',
       content: 'درخواست ساخت تصویر ثبت شد. در حال ساخت تصویر...',
       status: 'QUEUE',
       taskId
     });
     void pollImageTask(currentConversation.id, taskId, prompt);
     setImageGenPrompt('');
     pushToast('درخواست ساخت تصویر ثبت شد', 'success');
   } catch (error) {
     const message = error instanceof Error ? error.message : 'مشکلی در ساخت عکس پیش آمد.';
     setImageGenError(message);
     const currentConversation = await ensureConversationFromBackend();
     updateConversation(currentConversation.id, (item) => ({
       ...item,
       messages: dedupeChatMessages([
         ...item.messages,
         {
           id: generateMessageId('assistant-image-error'),
           role: 'assistant',
           type: 'image_error',
           intent: 'image_generation',
           content: message,
           timestamp: new Date().toISOString(),
           status: 'ERROR'
         }
       ]),
       updatedAt: new Date().toISOString()
     }));
     pushToast(message, 'danger');
   } finally {
     setIsGeneratingImage(false);
     setImageGenStatus('');
   }
 };

 const handleSaveProfileSettings = () => {
    if (!profile) {
      return;
    }

    const nextErrors: { name?: string; age?: string } = {};
    const numericAge = parseAgeInput(profileFormAge);

    if (!profileFormName.trim()) {
      nextErrors.name = 'نام نمی‌تواند خالی باشد.';
    }

    if (!profileFormAge || Number.isNaN(numericAge) || numericAge < ageMin) {
      nextErrors.age = `سن باید حداقل ${ageMin} سال باشد.`;
    }

    setProfileFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const nextProfile: AppProfile = {
      ...profile,
      name: profileFormName.trim(),
      age: numericAge,
      id: profile.id ?? generateUniqueId()
    };

    setProfile(nextProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (!savedTheme) {
      const newDefaultTheme = getDefaultThemeByAge(nextProfile.age);
      applyTheme(newDefaultTheme, false);
    }
    setShowProfileModal(false);
  };

  const renderAuthForm = ({ includeLanding = true }: { includeLanding?: boolean } = {}) => {
    const authCardClass = `register-card auth-card ${authTransition === 'back' ? 'slide-back' : 'slide-forward'}`;
    const authActionText = isCheckingPhone
      ? 'در حال بررسی شماره...'
      : isSendingVerification
        ? 'در حال ارسال کد...'
        : 'ادامه با کد تایید';
    return (
      <>
        {includeLanding && landingStep === 'landing' ? (
          <form className={`${authCardClass} auth-card--entry`} onSubmit={handleRegisterStepOne}>
            <div className="auth-brand">
              <span className="auth-logo-mark" aria-hidden="true">د</span>
              <div>
                <p className="auth-eyebrow">ورود به دانوآ</p>
                <h1>حساب کاربری</h1>
              </div>
            </div>
            <p className="subtitle">
              شماره موبایل را وارد کن؛ اگر قبلاً حساب داشته باشی وارد همان گفتگوها می‌شوی، و اگر تازه باشی بعد از تایید کد فقط اسم و سن را می‌پرسیم.
            </p>

            <TextField
              label="شماره موبایل"
              value={phone}
              onChange={(event) => setPhone(filterLocalizedDigits(event.target.value))}
              placeholder="09123456789"
              type="tel"
              inputMode="numeric"
              pattern="[0-9۰-۹٠-٩]*"
              maxLength={11}
              autoComplete="tel"
              helperText="کد تایید برای همین شماره پیامک می‌شود."
              errorText={errors.phone}
            />

            <Button type="submit" className="start-btn auth-primary-action" disabled={isSendingVerification || isCheckingPhone}>
              {authActionText}
            </Button>

            <div className="auth-divider" aria-hidden="true">
              <span />
              <b>یا</b>
              <span />
            </div>

            <div className="auth-landing-actions">
              <Button
                type="button"
                className="landing-btn secondary auth-guest-btn"
                variant="secondary"
                onClick={startGuestSession}
              >
                ورود به عنوان مهمان
              </Button>
            </div>
            <p className="helper onboarding-help">
              {hasSavedAccount ? 'روی این مرورگر قبلاً حساب ذخیره شده؛ با همان شماره وارد شو.' : 'مهمان می‌تواند شروع کند، اما برای نگه داشتن گفتگوها شماره لازم است.'}
            </p>
          </form>
        ) : registrationStep === 1 ? (
          <form className={authCardClass} onSubmit={handleRegisterStepOne}>
            {includeLanding ? (
              <button
                type="button"
                className="auth-back-btn"
                onClick={() => {
                  setAuthTransition('back');
                  setLandingStep('landing');
                  setErrors({});
                  setSignupToken('');
                }}
              >
                ← بازگشت
              </button>
            ) : null}
            <div className="auth-step-row">
              <span>1</span>
              <p>شماره موبایل</p>
            </div>
            <h1>ورود یا ساخت حساب</h1>
            <p className="subtitle">شماره را وارد کن تا کد تایید بفرستیم. دانوآ خودش تشخیص می‌دهد حساب قبلی داری یا نه.</p>

            <TextField
              label="شماره موبایل"
              value={phone}
              onChange={(event) => setPhone(filterLocalizedDigits(event.target.value))}
              placeholder="09123456789"
              type="tel"
              inputMode="numeric"
              pattern="[0-9۰-۹٠-٩]*"
              maxLength={11}
              autoComplete="tel"
              helperText="فرمت معتبر: 09XXXXXXXXX"
              errorText={errors.phone}
            />

            <Button type="submit" className="start-btn" disabled={isSendingVerification || isCheckingPhone}>
              {authActionText}
            </Button>
          </form>
        ) : registrationStep === 2 ? (
          <form className={authCardClass} onSubmit={handleVerifyCode}>
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => {
                setRegistrationStep(1);
                setVerificationCode('');
                setErrors({});
              }}
            >
              ← بازگشت
            </button>
            <div className="auth-step-row">
              <span>2</span>
              <p>تایید شماره</p>
            </div>
            <h1>کد تایید</h1>
            <p className="subtitle">کدی که برای شماره زیر پیامک شده را وارد کن.</p>
            <p className="auth-phone-badge" dir="ltr">{phone || '09XXXXXXXXX'}</p>

            <TextField
              label="کد تایید"
              value={verificationCode}
              onChange={(event) => setVerificationCode(filterLocalizedDigits(event.target.value))}
              placeholder="12345"
              type="tel"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              errorText={errors.code}
            />

            <div className="ds-auth-actions">
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setRegistrationStep(1);
                  setVerificationCode('');
                  setErrors({});
                }}
              >
                تغییر شماره
              </Button>
              <Button type="submit" className="start-btn" disabled={isVerifyingCode}>
                {isVerifyingCode ? 'در حال بررسی...' : 'تأیید'}
              </Button>
            </div>
          </form>
        ) : (
          <form className={authCardClass} onSubmit={handleCompleteProfile}>
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => {
                setRegistrationStep(2);
                setErrors({});
              }}
            >
              ← بازگشت
            </button>
            <div className="auth-step-row">
              <span>3</span>
              <p>تکمیل حساب</p>
            </div>
            <h1>اطلاعات کودک</h1>
            <p className="subtitle">این شماره قبلاً در دانوآ ثبت نشده بود. برای ساخت حساب، اسم و سن کودک را وارد کن.</p>
            <p className="auth-phone-badge" dir="ltr">{phone}</p>

            <TextField
              label="اسم کودک"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثلا: علی"
              type="text"
              autoComplete="name"
              errorText={errors.name}
            />

            <TextField
              label="سن کودک"
              value={age}
              onChange={(event) => setAge(filterLocalizedDigits(event.target.value))}
              placeholder="فقط عدد"
              type="text"
              inputMode="numeric"
              pattern="[0-9۰-۹٠-٩]*"
              helperText={`سن مجاز: ${ageMin} سال به بالا`}
              errorText={errors.age}
            />

            <div className="ds-auth-actions">
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setRegistrationStep(2);
                  setErrors({});
                }}
              >
                بازگشت
              </Button>
              <Button type="submit" className="start-btn" disabled={isVerifyingCode}>
                {isVerifyingCode ? 'در حال ساخت حساب...' : 'شروع گفتگو'}
              </Button>
            </div>
          </form>
        )}
      </>
    );
  };

  if (!hasCheckedSession && !profile) {
    return null;
  }

  if (!profile) {
    return (
      <div className="app-shell auth-shell">
        <div className="bg-blob blob-pink" />
        <div className="bg-blob blob-orange" />
        <div className="bg-blob blob-yellow" />
        <div className="bg-blob blob-purple" />

        {renderAuthForm()}
      </div>
    );
  }

  const shouldShowSendAction = inputValue.trim().length > 0 || attachments.length > 0;
  const canSendMessage = !isRecording && !isSending && shouldShowSendAction;
  const shouldShowGuestAuthCta = isGuestProfile(profile);
  const imagePromptLength = imageGenPrompt.trim().length;
  const canSubmitImagePrompt = imagePromptLength > 0 && !isGeneratingImage;

  return (
    <div className={`app-shell chat-shell view-${currentView} ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <div className="bg-blob blob-pink" />
      <div className="bg-blob blob-orange" />
      <div className="bg-blob blob-yellow" />
      <div className="bg-blob blob-purple" />

      {imagePreview ? (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="پیش‌نمایش تصویر" onClick={() => setImagePreview(null)}>
          <div className="image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="image-lightbox-toolbar">
              <a className="image-lightbox-action" href={imagePreview.src} download={imagePreview.downloadName}>
                دانلود
              </a>
              <a className="image-lightbox-icon" href={imagePreview.src} target="_blank" rel="noreferrer" aria-label="باز کردن در تب جدید" title="باز کردن">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 4h6v6" />
                  <path d="M10 14 20 4" />
                  <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
                </svg>
              </a>
              <button className="image-lightbox-icon" type="button" onClick={() => setImagePreview(null)} aria-label="بستن" title="بستن">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <img src={imagePreview.src} alt={imagePreview.alt} />
          </div>
        </div>
      ) : null}

      <div className="chat-card">
        {/* Warning banner for users logged in without a JWT token (pre-fix session) */}
        {!hasAuthToken && !isGuestProfile(profile) && (
          <div className="auth-token-warning" style={{
            background: '#fff3cd',
            color: '#856404',
            padding: '8px 16px',
            fontSize: '13px',
            textAlign: 'center',
            borderBottom: '1px solid #ffc107',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flexShrink: 0
          }}>
            <span>⚠️</span>
            <span>توکن احراز هویت شما ذخیره نشده. برای استفاده از ساخت عکس، لطفاً یک‌بار خارج و دوباره وارد شوید.</span>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                background: '#ffc107',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                color: '#856404',
                whiteSpace: 'nowrap'
              }}
            >
              خروج و ورود مجدد
            </button>
          </div>
        )}
        {currentView === 'chat' ? (
        <header className="top-bar">
          <div className="top-bar-main">
            <button
              className="menu-btn chat-back-btn"
              onClick={handleBackToHome}
              type="button"
              aria-label="برگشت به گفتگوها"
              title="برگشت به گفتگوها"
            >
              <svg className="chat-header-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 18 9 12l6-6" />
              </svg>
            </button>

            <div className="top-title">
              <div className="top-copy">
                <div className="top-copy-row chat-title-pill">
                  <span className="chat-title-icon" aria-hidden="true">د</span>
                  <span className="chat-title-text">
                    <strong>{activeConversation?.title || DEFAULT_TITLE}</strong>
                    <small>دانوآ همراهته</small>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="top-bar-actions">
            {shouldShowGuestAuthCta ? (
              <button
                className="header-auth-cta"
                type="button"
                onClick={handleOpenGuestAuth}
              >
                ورود / ثبت‌نام
              </button>
            ) : null}
            <button
              className="header-action-btn header-action-btn-secondary chat-share-btn"
              type="button"
              onClick={handleDownloadActiveConversation}
              aria-label="اشتراک‌گذاری گفتگو"
              title="اشتراک‌گذاری گفتگو"
            >
              <svg className="header-action-icon chat-header-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
              </svg>
            </button>
          </div>
        </header>
        ) : null}

        {currentView === 'home' ? (
        <aside className={`sidebar conversation-home ${sidebarOpen ? 'open' : ''}`}>
          <header className="conversation-home-header">
            <h3>گفتگوهای من</h3>
            <div className="conversation-home-tools">
              <button
                type="button"
                className="conversation-home-icon-btn conversation-home-icon-btn--search"
                aria-label="جستجو"
                title="جستجو"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M21 21l-5.2-5.2m1.7-4.55a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
                </svg>
              </button>
            </div>
          </header>

          <div className="conversation-list conversation-home-list">
            {orderedConversations.map((conversation, index) => {
              const isActive = conversation.id === activeConversationId;
              const isEditing = editingId === conversation.id;
              const visual = conversationVisuals[index % conversationVisuals.length];
              const preview = getConversationPreview(conversation);
              const dateLabel = formatConversationDate(conversation.updatedAt || conversation.createdAt);
              return (
                <div
                  className={`conversation-row conversation-card ${isActive ? 'active' : ''}`}
                  key={conversation.id}
                  onClick={() => {
                    setActiveConversationId(conversation.id);
                    setSidebarOpen(false);
                    navigateToView('chat');
                  }}
                >
                  <div className={`conversation-card-icon conversation-card-icon--${visual.tone}`} aria-hidden="true">
                    {visual.icon}
                  </div>

                  <div className="conversation-main">
                    {isEditing ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const title = editingTitle.trim() || DEFAULT_TITLE;
                          updateConversation(conversation.id, (item) => ({ ...item, title }));
                          setEditingId(null);
                        }}
                      >
                        <input
                          autoFocus
                          className="rename-input ds-field__input"
                          value={editingTitle}
                          onBlur={() => setEditingId(null)}
                          onChange={(event) => setEditingTitle(event.target.value)}
                        />
                      </form>
                    ) : (
                      <>
                        <p>{conversation.title || DEFAULT_TITLE}</p>
                        <small>{preview}</small>
                      </>
                    )}
                  </div>

                  <div className="conversation-card-meta" onClick={(event) => event.stopPropagation()}>
                    <span className="conversation-card-date">
                      {conversation.pinned ? <span aria-hidden="true">⭐</span> : null}
                      {dateLabel}
                    </span>
                    <div className="conversation-actions">
                    <Button
                      type="button"
                      iconOnly
                      size="sm"
                      variant="ghost"
                      aria-label="سنجاق گفتگو"
                      title="سنجاق"
                      className={`conversation-action-btn ${conversation.pinned ? 'pinned' : ''}`}
                      onClick={() =>
                        updateConversation(conversation.id, (item) => ({
                          ...item,
                          pinned: !item.pinned,
                          updatedAt: new Date().toISOString()
                        }))
                      }
                    >
                      📌
                    </Button>
                    <Button
                      type="button"
                      iconOnly
                      size="sm"
                      variant="ghost"
                      aria-label="تغییر نام گفتگو"
                      className="conversation-action-btn"
                      title="تغییر نام"
                      onClick={() => {
                        setEditingId(conversation.id);
                        setEditingTitle(conversation.title);
                      }}
                    >
                      ✏️
                    </Button>
                    <Button
                      type="button"
                      iconOnly
                      size="sm"
                      variant="ghost"
                      aria-label="حذف گفتگو"
                      className="conversation-action-btn"
                      title="حذف"
                      onClick={() => handleDeleteConversation(conversation.id)}
                    >
                      🗑️
                    </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <nav className="conversation-bottom-nav" aria-label="ناوبری گفتگوها">
            <button type="button" className="conversation-nav-item" onClick={handleOpenSettings} aria-label="پروفایل">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
                <path d="M19.4 15a1.7 1.7 0 00.34 1.88l.05.05a2 2 0 01-2.83 2.83l-.05-.05a1.7 1.7 0 00-1.88-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.07a1.7 1.7 0 00-1.03-1.56 1.7 1.7 0 00-1.88.34l-.05.05a2 2 0 01-2.83-2.83l.05-.05A1.7 1.7 0 004.6 15 1.7 1.7 0 003.04 14H3a2 2 0 010-4h.04A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.88l-.05-.05a2 2 0 012.83-2.83l.05.05A1.7 1.7 0 008.97 4.6 1.7 1.7 0 0010 3.04V3a2 2 0 014 0v.04a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.88-.34l.05-.05a2 2 0 012.83 2.83l-.05.05A1.7 1.7 0 0019.4 9c.23.63.81 1 1.56 1H21a2 2 0 010 4h-.04A1.7 1.7 0 0019.4 15z" />
              </svg>
              <span>پروفایل</span>
            </button>
            <button type="button" className="conversation-nav-item" onClick={handleViewPlans}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              <span>اشتراک</span>
            </button>
            <button type="button" className="conversation-nav-fab" onClick={handleCreateConversation} aria-label="شروع گفتگوی جدید">
              +
            </button>
            <button type="button" className="conversation-nav-item" onClick={handleGenerateImageClick} title="عکس" aria-label="ساخت تصویر">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14" />
                <path d="M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>عکس</span>
            </button>
            <button type="button" className="conversation-nav-item active" onClick={() => navigateToView('chat')}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M21 11.5c0 4.14-4.03 7.5-9 7.5a10.5 10.5 0 01-4.52-1L3 19l1.4-3.28A6.76 6.76 0 013 11.5C3 7.36 7.03 4 12 4s9 3.36 9 7.5z" />
                <path d="M8 11h.01M12 11h.01M16 11h.01" />
              </svg>
              <span>چت</span>
            </button>
          </nav>
        </aside>
        ) : null}
        {currentView === 'generate' ? (
          <main className="generate-page">
            <header className="generate-page-header">
              <button
                className="generate-page-back"
                type="button"
                onClick={handleBackToHome}
                aria-label="بازگشت به گفتگوها"
                title="بازگشت"
              >
                <svg className="chat-header-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 18 9 12l6-6" />
                </svg>
              </button>
              <div>
                <span>ابزار خلاقیت</span>
                <h1>ساخت تصویر</h1>
              </div>
            </header>

            <section className="generate-page-card">
              <div className="image-gen-hero" aria-hidden="true">
                <span className="image-gen-glow" />
                <span className="image-gen-orb">
                  <span className="image-gen-wand">🪄</span>
                </span>
                <span className="image-gen-star image-gen-star--one" />
                <span className="image-gen-star image-gen-star--two" />
                <span className="image-gen-star image-gen-star--three" />
              </div>

              <div className="image-gen-copy">
                <h2>چی می‌خوای بسازی؟</h2>
                <p>سوژه، سبک، رنگ و حس تصویر را کوتاه و روشن بنویس.</p>
              </div>

              <div className="image-gen-examples" aria-label="نمونه پرامپت‌ها">
                {IMAGE_PROMPT_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setImageGenPrompt(example);
                      setImageGenError('');
                    }}
                    disabled={isGeneratingImage}
                  >
                    {example}
                  </button>
                ))}
              </div>

              <label className="image-gen-field">
                <textarea
                  dir="rtl"
                  value={imageGenPrompt}
                  onChange={(event) => {
                    setImageGenPrompt(event.target.value.slice(0, IMAGE_PROMPT_MAX_LENGTH));
                    setImageGenError('');
                  }}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void handleGenerateImageSubmit();
                    }
                  }}
                  placeholder="مثلاً: یک گربه فضایی بامزه، سبک سه‌بعدی، رنگ‌های شاد، نور نرم"
                  disabled={isGeneratingImage}
                  aria-label="توضیح تصویر"
                  maxLength={IMAGE_PROMPT_MAX_LENGTH}
                />
              </label>

              <div className="image-gen-meta">
                <span>{imagePromptLength}/{IMAGE_PROMPT_MAX_LENGTH}</span>
                <span>Ctrl + Enter برای ساخت</span>
              </div>

              {imageGenStatus ? <div className="image-gen-status">{imageGenStatus}</div> : null}
              {imageGenError ? <div className="image-gen-error">{imageGenError}</div> : null}

              <Button
                type="button"
                className="image-gen-submit generate-page-submit"
                onClick={handleGenerateImageSubmit}
                disabled={!canSubmitImagePrompt}
              >
                <span>{isGeneratingImage ? 'در حال ساخت...' : 'ساخت تصویر'}</span>
                <span aria-hidden="true">✦</span>
              </Button>
            </section>
          </main>
        ) : null}
        {currentView === 'profile' ? (
          <main className="profile-page">
            <header className="profile-page-header">
              <button
                className="generate-page-back"
                type="button"
                onClick={handleBackToHome}
                aria-label="بازگشت به گفتگوها"
                title="بازگشت"
              >
                <svg className="chat-header-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 18 9 12l6-6" />
                </svg>
              </button>
              <div>
                <span>حساب کاربری</span>
                <h1>پروفایل</h1>
              </div>
            </header>

            <section className="profile-page-grid">
              <div className="profile-page-card profile-page-card-main">
                <div className="profile-avatar" aria-hidden="true">
                  {String(profile.name || 'ک').trim().charAt(0) || 'ک'}
                </div>
                <div className="profile-page-fields">
                  <TextField label="نام" type="text" value={profileFormName} onChange={(event) => setProfileFormName(event.target.value)} errorText={profileFormErrors.name} />
                  <TextField
                    label="سن"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9۰-۹٠-٩]*"
                    value={profileFormAge}
                    onChange={(event) => setProfileFormAge(filterLocalizedDigits(event.target.value))}
                    errorText={profileFormErrors.age}
                  />
                  <TextField label="شماره والد" type="text" value={profile.phone || '-'} readOnly helperText="شماره والد هنگام ثبت نام تعیین می‌شود." />
                </div>
                <div className="profile-id-box">
                  <span>شناسه یکتا:</span>
                  <code>{String(profile.id ?? '')}</code>
                </div>
                <Button type="button" className="start-btn" onClick={() => { handleSaveProfileSettings(); pushToast('تغییرات ذخیره شد', 'success'); }}>
                  ذخیره تغییرات
                </Button>
              </div>

              <div className="profile-page-card">
                <div className="profile-section">
                  <label>تم سایت</label>
                  <div className="profile-theme-actions">
                    <Button type="button" className={`theme-btn ${theme === 'energy' ? 'active' : ''}`} onClick={() => applyTheme('energy')}>
                      انرژی
                    </Button>
                    <Button type="button" className={`theme-btn ${theme === 'calm' ? 'active' : ''}`} onClick={() => applyTheme('calm')}>
                      آرامش
                    </Button>
                  </div>
                </div>

                <div className="parent-panel">
                  <div className="parent-panel__header">
                    <div>
                      <strong>پنل والد</strong>
                      <span>مدیریت امن حساب کودک</span>
                    </div>
                    <span className="parent-panel__badge">فعال</span>
                  </div>

                  <div className="parent-panel__grid">
                    <div>
                      <span>کودک</span>
                      <strong>{profileFormName.trim() || profile.name || 'کودک'}</strong>
                    </div>
                    <div>
                      <span>شماره والد</span>
                      <strong>{profile.phone || '-'}</strong>
                    </div>
                    <div>
                      <span>سطح ایمنی</span>
                      <strong>{Number(profile.age || 0) <= 12 ? 'سخت‌گیرانه' : 'استاندارد'}</strong>
                    </div>
                    <div>
                      <span>پیام مهمان</span>
                      <strong>{String(publicSettings['guest.limit_modal.badge_text'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.badge_text'])} پیام</strong>
                    </div>
                  </div>

                  <div className="parent-panel__actions">
                    <Button type="button" variant="secondary" onClick={handleViewPlans}>
                      مدیریت اشتراک
                    </Button>
                    <Button type="button" variant="ghost" onClick={handleDownloadActiveConversation}>
                      ذخیره گفتگوی فعلی
                    </Button>
                  </div>
                </div>

                <div className="profile-danger-actions">
                  <Button type="button" variant="danger" onClick={handleDeleteAllConversations}>
                    حذف همه گفتگوها
                  </Button>
                  <Button type="button" variant="danger" onClick={handleLogout}>
                    خروج از حساب کاربری
                  </Button>
                </div>
              </div>
            </section>
          </main>
        ) : null}
        {currentView === 'home' && sidebarOpen ? (
          <button
            className="sidebar-hitbox"
            type="button"
            aria-label="بستن منو"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {showProfileModal ? (
          <Dialog open={showProfileModal} title="تنظیمات پروفایل" onClose={() => setShowProfileModal(false)} showFooter={false}>
            <div className="profile-modal">
              <TextField label="نام" type="text" value={profileFormName} onChange={(event) => setProfileFormName(event.target.value)} errorText={profileFormErrors.name} />

              <TextField
                label="سن"
                type="text"
                inputMode="numeric"
                pattern="[0-9۰-۹٠-٩]*"
                value={profileFormAge}
                onChange={(event) => setProfileFormAge(filterLocalizedDigits(event.target.value))}
                errorText={profileFormErrors.age}
              />

              <TextField label="شماره موبایل" type="text" value={profile.phone || '-'} readOnly helperText="شماره موبایل فقط هنگام ثبت نام تعیین می شود." />

              <div className="profile-id-box">
                <span>شناسه یکتا:</span>
                <code>{String(profile.id ?? '')}</code>
              </div>

              <div className="profile-section">
                <label>تم سایت</label>
                <div className="profile-theme-actions">
                  <Button
                    type="button"
                    className={`theme-btn ${theme === 'energy' ? 'active' : ''}`}
                    onClick={() => applyTheme('energy')}
                  >
                    انرژی
                  </Button>
                  <Button
                    type="button"
                    className={`theme-btn ${theme === 'calm' ? 'active' : ''}`}
                    onClick={() => applyTheme('calm')}
                  >
                    آرامش
                  </Button>
                </div>
              </div>

              <div className="parent-panel">
                <div className="parent-panel__header">
                  <div>
                    <strong>پنل والد</strong>
                    <span>مدیریت امن حساب کودک</span>
                  </div>
                  <span className="parent-panel__badge">فعال</span>
                </div>

                <div className="parent-panel__grid">
                  <div>
                    <span>کودک</span>
                    <strong>{profileFormName.trim() || profile.name || 'کودک'}</strong>
                  </div>
                  <div>
                    <span>شماره والد</span>
                    <strong>{profile.phone || '-'}</strong>
                  </div>
                  <div>
                    <span>سطح ایمنی</span>
                    <strong>{Number(profile.age || 0) <= 12 ? 'سخت‌گیرانه' : 'استاندارد'}</strong>
                  </div>
                  <div>
                    <span>پیام مهمان</span>
                    <strong>{String(publicSettings['guest.limit_modal.badge_text'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.badge_text'])} پیام</strong>
                  </div>
                </div>

                <div className="parent-panel__actions">
                  <Button type="button" variant="secondary" onClick={handleViewPlans}>
                    مدیریت اشتراک
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleDownloadActiveConversation}>
                    ذخیره گفتگوی فعلی
                  </Button>
                </div>
              </div>

              <div className="profile-danger-actions">
                <Button type="button" variant="danger" onClick={handleDeleteAllConversations}>
                  حذف همه گفتگوها
                </Button>
                <Button type="button" variant="danger" onClick={handleLogout}>
                  خروج از حساب کاربری
                </Button>
              </div>

              <div className="modal-buttons">
                <Button type="button" className="start-btn" onClick={() => { handleSaveProfileSettings(); pushToast('تغییرات ذخیره شد', 'success'); }}>
                  ذخیره تغییرات
                </Button>
                <Button type="button" variant="danger" onClick={() => setShowProfileModal(false)}>
                  انصراف
                </Button>
              </div>
            </div>
          </Dialog>
        ) : null}
        {showSettingsAuthModal ? (
          <Dialog
            open={showSettingsAuthModal}
            title="ورود / ثبت‌نام"
            onClose={() => {
              setShowSettingsAuthModal(false);
              setReturnToChatAfterAuth(false);
              setErrors({});
              setVerificationCode('');
              setSignupToken('');
            }}
            showFooter={false}
          >
            {renderAuthForm({ includeLanding: false })}
          </Dialog>
        ) : null}

       {showMessageLimitModal ? (
         <Dialog open={showMessageLimitModal} title="آهووو! به سقف پیام‌ها رسیدی" onClose={() => setShowMessageLimitModal(false)} showFooter={false}>
           <div className="message-limit-modal">
             <button
               type="button"
               className="message-limit-close"
               aria-label="بستن"
               onClick={() => setShowMessageLimitModal(false)}
             >
               ×
             </button>

             <div className="message-limit-hero" aria-hidden="true">
               <span className="message-limit-glow" />
               <span className="message-limit-dragon">🐉</span>
               <span className="message-limit-tear">😢</span>
             </div>

             <div className="message-limit-copy">
               <h2>آهووو! به سقف پیام‌ها رسیدی</h2>
               <p>برای ادامه چت با دانوآ، یکی از پلن‌های ما رو انتخاب کن</p>
             </div>

             <div className="message-limit-actions">
               <Button
                 type="button"
                 size="lg"
                 className="message-limit-primary"
                 onClick={handleViewPlans}
                 endIcon={
                   <svg className="message-limit-medal" viewBox="0 0 24 24" focusable="false">
                     <path d="M8 3h8l-1.6 4.2a6 6 0 1 1-4.8 0L8 3Z" />
                     <path d="M12 9.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3.9-1.8Z" />
                     <path d="M9 16.7V22l3-1.8 3 1.8v-5.3" />
                   </svg>
                 }
               >
                 مشاهده پلن‌ها
               </Button>
               <button type="button" className="message-limit-later" onClick={handleRemindMessageLimitLater}>
                 بعداً یادآوری کن
               </button>
             </div>
           </div>
         </Dialog>
       ) : null}

       {showGuestLimitModal ? (
         <Dialog
           open={showGuestLimitModal}
           title={String(publicSettings['guest.limit_modal.title'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.title'])}
           onClose={() => setShowGuestLimitModal(false)}
           showFooter={false}
         >
           <div className="guest-limit-modal">
             <div className="guest-limit-hero" aria-hidden="true">
               <span className="guest-limit-badge">
                 {guestLimitInfo?.limit ? String(guestLimitInfo.limit) : String(publicSettings['guest.limit_modal.badge_text'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.badge_text'])}
               </span>
             </div>

             <div className="guest-limit-copy">
               <h2>{String(publicSettings['guest.limit_modal.heading'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.heading'])}</h2>
               <p>{String(publicSettings['guest.limit_modal.body'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.body'])}</p>
               {guestLimitInfo ? (
                 <small>
                   {guestLimitInfo.usage} پیام مهمان از {guestLimitInfo.limit} پیام رایگان استفاده شده است.
                 </small>
               ) : null}
             </div>

             <div className="guest-limit-actions">
               <Button
                 type="button"
                 size="lg"
                 className="guest-limit-primary"
                 onClick={handleGuestSignupRequired}
               >
                 {String(publicSettings['guest.limit_modal.cta'] || PUBLIC_SETTINGS_DEFAULTS['guest.limit_modal.cta'])}
               </Button>
               <button type="button" className="guest-limit-later" onClick={() => setShowGuestLimitModal(false)}>
                 فعلاً در چت بمانم
               </button>
             </div>
           </div>
         </Dialog>
       ) : null}

       {showImageGenModal ? (
         <Dialog open={showImageGenModal} title="ساخت تصویر" onClose={handleCloseImageGenerator} showFooter={false}>
           <div className="image-gen-modal">
             <button
               type="button"
               className="image-gen-close"
               aria-label="بستن"
               onClick={(event) => {
                 event.stopPropagation();
                 handleCloseImageGenerator();
               }}
             >
               ×
             </button>

             <div className="image-gen-hero" aria-hidden="true">
               <span className="image-gen-glow" />
               <span className="image-gen-orb">
                 <span className="image-gen-wand">🪄</span>
               </span>
               <span className="image-gen-star image-gen-star--one" />
               <span className="image-gen-star image-gen-star--two" />
               <span className="image-gen-star image-gen-star--three" />
             </div>

             <div className="image-gen-copy">
               <h2>چی می‌خوای بسازی؟</h2>
               <p>سوژه، سبک، رنگ و حس تصویر را کوتاه و روشن بنویس.</p>
             </div>

             <div className="image-gen-examples" aria-label="نمونه پرامپت‌ها">
               {IMAGE_PROMPT_EXAMPLES.map((example) => (
                 <button
                   key={example}
                   type="button"
                   onClick={() => {
                     setImageGenPrompt(example);
                     setImageGenError('');
                   }}
                   disabled={isGeneratingImage}
                 >
                   {example}
                 </button>
               ))}
             </div>

             <label className="image-gen-field">
               <textarea
                 dir="rtl"
                 value={imageGenPrompt}
                 onChange={(event) => {
                   setImageGenPrompt(event.target.value.slice(0, IMAGE_PROMPT_MAX_LENGTH));
                   setImageGenError('');
                 }}
                 onKeyDown={(event) => {
                   if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                     event.preventDefault();
                     void handleGenerateImageSubmit();
                   }
                 }}
                 placeholder="مثلاً: یک گربه فضایی بامزه، سبک سه‌بعدی، رنگ‌های شاد، نور نرم"
                 disabled={isGeneratingImage}
                 aria-label="توضیح تصویر"
                 maxLength={IMAGE_PROMPT_MAX_LENGTH}
               />
             </label>

             <div className="image-gen-meta">
               <span>{imagePromptLength}/{IMAGE_PROMPT_MAX_LENGTH}</span>
               <span>Ctrl + Enter برای ساخت</span>
             </div>

             {imageGenStatus ? <div className="image-gen-status">{imageGenStatus}</div> : null}
             {imageGenError ? <div className="image-gen-error">{imageGenError}</div> : null}

             <Button
               type="button"
               className="image-gen-submit"
               onClick={handleGenerateImageSubmit}
               disabled={!canSubmitImagePrompt}
             >
               <span>{isGeneratingImage ? 'در حال ساخت...' : 'بساز'}</span>
               <span aria-hidden="true">✦</span>
             </Button>
           </div>
         </Dialog>
       ) : null}

       {currentView === 'chat' ? (
       <main className="messages-area" ref={messagesContainerRef}>
          {visibleMessages.length ? (
            visibleMessages.map((message, index) => (
              <div
                key={`${message.timestamp}-${index}`}
                className={`message-row ${message.role} ${Array.isArray(message.images) && message.images.length > 0 ? 'has-images' : ''}`}
                ref={(node) => {
                  if (index === visibleMessages.length - 1) {
                    lastMessageRef.current = node;
                  }
                  if (message.role === 'assistant' && index === lastAssistantMessageIndex) {
                    botMessageRef.current = node;
                  }
                }}
              >
                {message.role === 'assistant' ? renderBotAvatar() : null}
                {message.role === 'assistant' ? (
                  <div className="bubble markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    {Array.isArray(message.images) && message.images.length > 0 ? (
                      <div className="message-image-grid">
                        {message.images.map((image, imageIndex) => (
                          <MessageImage
                            key={`${image.url}-${imageIndex}`}
                            src={image.url}
                            alt={image.alt || 'تصویر ارسال شده'}
                            index={imageIndex}
                            onOpenPreview={setImagePreview}
                          />
                        ))}
                      </div>
                    ) : null}
                    <span className="message-time">{formatMessageTime(message.timestamp)}</span>
                  </div>
                ) : (
                  <div className="bubble">
                    {message.content ? <div>{message.content}</div> : null}
                    {Array.isArray(message.images) && message.images.length > 0 ? (
                      <div className="message-image-grid">
                        {message.images.map((image, imageIndex) => (
                          <MessageImage
                            key={`${image.url}-${imageIndex}`}
                            src={image.url}
                            alt={image.alt || 'تصویر ارسال شده'}
                            index={imageIndex}
                            onOpenPreview={setImagePreview}
                          />
                        ))}
                      </div>
                    ) : null}
                    <span className="message-time">{formatMessageTime(message.timestamp)}</span>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state chat-empty-state">
              <strong>سلام، من دانوآم</strong>
              <span>می‌تونی سؤال بپرسی، عکس بفرستی یا تصویر بسازی.</span>
            </div>
          )}

          {isSending ? (
            <div className="message-row assistant" ref={lastMessageRef}>
              {renderBotAvatar()}
              <div className="bubble">
                <span>{WAITING_MESSAGES[waitingTextIndex]}</span>
                <span className="typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          ) : null}
        </main>
       ) : null}

       {currentView === 'chat' ? (
        <footer className="input-area" ref={inputAreaRef}>
          <div className="input-shell">
            {attachments.length > 0 ? (
              <div className="image-thumb-grid">
                {attachments.map((attachment) => (
                  <div className="image-thumb-wrap" key={attachment.id}>
                    <div className="image-thumb-meta">
                      <img className="image-thumb" src={attachment.previewUrl} alt={attachment.file.name} />
                      <div className="image-thumb-copy">
                        <strong>{attachment.file.name}</strong>
                        <span>وضعیت: {attachment.status}</span>
                        {attachment.error ? <span>{attachment.error}</span> : null}
                      </div>
                    </div>
                    <div className="image-thumb-actions">
                      {attachment.status === 'error' ? (
                        <button className="retry-thumb-btn" type="button" onClick={() => handleRetryUpload(attachment.id)}>
                          تلاش مجدد
                        </button>
                      ) : null}
                      <button className="remove-thumb-btn" type="button" aria-label="حذف تصویر" onClick={() => handleRemoveImage(attachment.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className={`composer-row ${isRecording ? 'recording' : ''} ${shouldShowSendAction ? 'has-action' : 'voice-action'}`}>
              <div className={`composer-card ${isRecording ? 'recording' : ''} ${canSendMessage ? 'ready' : ''}`}>
                <div className="composer-main">
                  <div className="message-field">
                    <textarea
                      ref={messageInputRef}
                      dir="auto"
                      rows={Math.min(4, Math.max(1, inputValue.split('\n').length))}
                      value={inputValue}
                      disabled={isRecording}
                      onChange={(event) => setInputValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder={isRecording ? 'در حال ضبط صدا...' : 'پیام خود را بنویسید...'}
                      aria-label="نوشتن پیام"
                    />
                    <div className="composer-hint">
                      <span>{isRecording ? 'ضبط صدا فعال است' : 'Enter برای ارسال، Shift + Enter برای خط جدید'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {!isRecording ? (
                <div className="attachment-rail">
                  <div className="attachment-box attachment-tools" ref={attachmentBoxRef}>
                    <button
                      className="attach-btn"
                      type="button"
                      aria-label="ارسال عکس"
                      title="ارسال عکس"
                      onClick={handlePickImageClick}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 16l4.6-4.6a2 2 0 0 1 2.8 0L16 16m-2-2 1.6-1.6a2 2 0 0 1 2.8 0L20 14" />
                        <path d="M14 8h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
                      </svg>
                    </button>
                    {attachmentMenuOpen ? (
                     <div className="attachment-popup" role="menu" aria-label="گزینه‌های پیوست">
                       <button type="button" onClick={handlePickImageClick}>
                         <span aria-hidden="true">📷</span>
                         ارسال عکس
                       </button>
                       <button type="button" onClick={handleGenerateImageClick}>
                         <span aria-hidden="true">🎨</span>
                         ساخت عکس با هوش مصنوعی
                       </button>
                       <button
                         type="button"
                         className="menu-item-disabled"
                          onClick={() => {
                            setAttachmentMenuOpen(false);
                            pushToast('به زودی فعال میشه این بخش ...', 'warning');
                          }}
                        >
                          <span aria-hidden="true">📄</span>
                          ارسال فایل
                        </button>
                      </div>
                    ) : null}
                    <input ref={imageInputRef} type="file" accept={imageAccept} multiple hidden onChange={handleImageSelect} />
                  </div>
                </div>
              ) : null}

              <div className="composer-actions">
                {isRecording ? (
                  <>
                    <button className="confirm-btn" type="button" onClick={handleConfirmRecording} aria-label="ارسال پیام ضبط شده">
                      تایید
                    </button>
                    <button className="cancel-btn" type="button" onClick={handleCancelRecording} aria-label="لغو ضبط صدا">
                      لغو
                    </button>
                  </>
                ) : (
                  <button
                    className={`send-btn action-toggle-btn ${shouldShowSendAction ? 'show-send' : 'show-mic'}`}
                    type="button"
                    onClick={shouldShowSendAction ? () => void handleSendMessage() : handleStartRecording}
                    aria-label={shouldShowSendAction ? 'ارسال پیام' : 'شروع ضبط صدا'}
                    title={shouldShowSendAction ? 'ارسال پیام' : 'شروع ضبط صدا'}
                    disabled={isSending || (shouldShowSendAction && !canSendMessage)}
                  >
                    <span
                      key={shouldShowSendAction ? 'send' : 'mic'}
                      className={`action-icon ${shouldShowSendAction ? 'action-icon-send' : 'action-icon-mic'}`}
                      aria-hidden="true"
                    >
                      {shouldShowSendAction ? (
                        <svg viewBox="0 0 24 24">
                          <path d="M4.3 11.3 19.5 4.7c.9-.4 1.8.5 1.4 1.4l-6.6 15.2a1 1 0 0 1-1.9-.2l-1-5.7-5.7-1a1 1 0 0 1-.2-1.9Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24">
                          <path d="M12 3.5a3 3 0 0 0-3 3V12a3 3 0 1 0 6 0V6.5a3 3 0 0 0-3-3Z" />
                          <path d="M6.5 11a.9.9 0 0 1 .9.9V12a4.6 4.6 0 0 0 9.2 0v-.1a.9.9 0 1 1 1.8 0V12a6.4 6.4 0 0 1-5.5 6.3V20h2a.9.9 0 1 1 0 1.8H9.1a.9.9 0 1 1 0-1.8h2v-1.7A6.4 6.4 0 0 1 5.6 12v-.1a.9.9 0 0 1 .9-.9Z" />
                        </svg>
                      )}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </footer>
       ) : null}
      </div>
    </div>
  );
}

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const adminPath = '/admin-secure-9x7k';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('dir', 'rtl');
  }

  if (pathname === '/admin/login') {
    return <AdminLogin onLoginSuccess={() => { window.location.href = adminPath; }} />;
  }

  if (pathname === adminPath) {
    return <AdminPanel />;
  }

  if (pathname === '/design-system-preview') {
    return (
      <ToastProvider>
        <DesignSystemPreview />
      </ToastProvider>
    );
  }

  if (pathname === '/') {
    return <DanuaLanding />;
  }

  if (pathname === '/plans') {
    return <PlansPage />;
  }

  if (pathname === '/payment/success' || pathname === '/success') {
    return <PaymentSuccessPage />;
  }

  if (
    pathname !== '/chat' &&
    pathname !== '/home' &&
    pathname !== '/generate' &&
    pathname !== '/photos' &&
    pathname !== '/profile' &&
    pathname !== '/settings'
  ) {
    return <DanuaLanding />;
  }

  return (
    <ToastProvider>
      <ChatApp />
    </ToastProvider>
  );
}

export default App;
