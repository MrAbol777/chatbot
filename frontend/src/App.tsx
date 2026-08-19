import { ChangeEvent, FormEvent, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Conversation, UserProfile } from './types';
import { PUBLIC_ASSETS } from './config/publicAssets';
import {
  fetchProtectedImageBlobUrl,
  getImageGenerationStatusForConversation,
  startImageGeneration
} from './services/imageGeneration';
import { Button, Dialog, InlineMessage, TextField, useNotification } from './design-system/components';
import Icon from './components/Icon';
import type { IconName } from './components/Icon';
import EmptyState from './components/EmptyState';
import InsufficientBalanceNotice from './components/InsufficientBalanceNotice';
import DanoaLoadingMark from './components/DanoaLoadingMark';
import ProfileForm from './components/ProfileForm';
import NoaWalletPanel from './noa/NoaWalletPanel';
import { formatDecimalFa } from './noa/decimal';
import { fetchPendingNoaNotifications } from './noa/noa.service';
import { useNoaWallet } from './noa/useNoaWallet';
import {
  authNoticeMessage,
  clearSessionCsrfToken,
  loadDanoaSession,
  loadVianaConfig,
  setSessionCsrfToken,
  type AuthNotice,
  type DanoaSessionResponse
} from './auth/danoaSession';

const AdminLogin = lazy(() => import('./AdminLogin'));
const AdminPanel = lazy(() => import('./AdminPanel'));
const LandingPage = lazy(() => import('./Landing'));
const NotFound = lazy(() => import('./NotFound'));
const ImageStudio = lazy(() => import('./ImageStudio'));
const StudioPage = lazy(() => import('./studio/StudioPage'));
const VideoGenerationPage = lazy(() => import('./video-generation/VideoGenerationPage'));
const DesignSystemPreview = lazy(() => import('./design-system/preview/DesignSystemPreview'));

const PROFILE_KEY = 'chat_profile';
const PROFILES_KEY = 'chat_profiles';
const CONVERSATIONS_KEY = 'chat_conversations';
const ACTIVE_CONVERSATION_KEY = 'chat_active_conversation_id';
const THEME_KEY = 'danoa_theme';
const SIDEBAR_COLLAPSED_KEY = 'danoa_sidebar_collapsed';
const DEFAULT_TITLE = 'گفتگوی جدید';

const getInitialSidebarState = () => {
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
const SUGGESTION_PROMPTS: Array<{ label: string; prompt: string; icon: IconName }> = [
  { label: 'به من در تحقیق یک ایده کمک کن', prompt: 'به من در تحقیق یک ایده کمک کن', icon: 'edit' },
  { label: 'خلاصه این مقاله را بنویس', prompt: 'خلاصه این مقاله را بنویس', icon: 'file-text' },
  { label: 'ایده‌هایی برای محتوا بده', prompt: 'ایده‌هایی برای محتوا بده', icon: 'lightbulb' }
];
const IMAGE_PROMPT_MAX_LENGTH = 700;
const BOT_AVATAR_FALLBACK_URL = PUBLIC_ASSETS.botAvatar;
const CHAT_DRAFT_NEW_KEY = 'danoa:chat-draft:new';
const LAST_STUDIO_CHAT_PATH_KEY = 'danoa:studio-return-chat-path';
const ATTACHMENT_MENU_ID = 'chat-attachment-menu';
const ATTACHMENT_MENU_ITEMS: ReadonlyArray<{
  id: 'image';
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: 'image',
    label: 'ارسال عکس',
    description: 'JPG، PNG یا WebP',
    icon: 'attach-image'
  }
];

const getChatDraftKey = (conversationId: string) =>
  conversationId ? `danoa:chat-draft:${conversationId}` : CHAT_DRAFT_NEW_KEY;

const readSessionValue = (key: string) => {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeSessionValue = (key: string, value: string) => {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Session storage is an optional convenience; the chat must work without it.
  }
};

type AppProfile = UserProfile & { id?: number | string; authProvider?: 'otp' | 'viana' };

const removeLegacyLocalDevelopmentCredentials = () => {
  if (!import.meta.env.DEV) return;
  try {
    const rawProfile = localStorage.getItem(PROFILE_KEY);
    if (!rawProfile) return;
    const savedProfile = JSON.parse(rawProfile) as Partial<AppProfile>;
    if (savedProfile.phone !== '09000000001') return;
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem('chat_auth_token');
  } catch {
    // Invalid persisted auth data is handled by the normal session bootstrap.
  }
};

type RecordingAction = 'idle' | 'confirm' | 'cancel';
type LandingStep = 'landing' | 'login' | 'signup' | 'chat';
type AppView = 'chat' | 'studio' | 'images' | 'video' | 'profile' | 'noa';
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
  retryAfter?: number;
  retryAfterSeconds?: number;
  actionKey?: string;
  balanceNoa?: string;
  requiredNoa?: string;
  shortfallNoa?: string;
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
  if (pathname === '/' || pathname === '/chat' || /^\/c\/[^/]+$/.test(pathname)) return 'chat';
  if (pathname === '/studio') return 'studio';
  if (pathname === '/studio/image' || pathname === '/images' || pathname === '/generate' || pathname === '/photos') return 'images';
  if (pathname === '/studio/video') return 'video';
  if (pathname === '/profile' || pathname === '/settings') return 'profile';
  if (pathname === '/noa') return 'noa';
  return 'chat';
};
const isDesktopChatLayout = () =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1200px)').matches;
const getConversationIdFromPath = (pathname: string) => {
  const match = pathname.match(/^\/c\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
};
type ApiError = Error & {
  redirectTo?: AuthMode | null;
  status?: number;
  retryAfterSeconds?: number;
};
type ChatRequestError = Error & { status?: number; payload?: ApiErrorData };
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
  imageStudioRedirect?: boolean;
};
type ChatStreamEvent = {
  type: 'meta' | 'delta' | 'done' | 'error' | 'cancelled' | 'title';
  status?: 'streaming' | 'completed' | 'cancelled' | 'failed';
  turnId: string;
  attemptId: string;
  intent?: 'chat' | 'image_understanding';
  delta?: string;
  reply?: string;
  conversationId?: string;
  error?: string;
  message?: string;
  retryable?: boolean;
  imageStudioRedirect?: boolean;
  title?: string;
  titleStatus?: 'completed' | 'fallback' | 'skipped';
};
type ChatStreamPayload = {
  message: string;
  imageIds?: string[];
  history?: ChatMessage[];
  profile: UserProfile;
  personality: PersonalityProfile;
  conversationId?: string;
  clientMessageId?: string;
  turnId: string;
  attemptId: string;
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
        <Icon name="info-circle" size="1.1em" aria-hidden="true" /> خطا در بارگذاری تصویر — لطفاً دوباره تلاش کنید
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

const postChatStream = async (
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
    if (buffer.trim()) {
      const event = JSON.parse(buffer) as ChatStreamEvent;
      await onEvent(event);
      if (event.type === 'done') doneEvent = event;
      if (event.type === 'error') throw createChatRequestError(event.message || 'دریافت پاسخ ناموفق بود.', 502, { error: event.error });
    }
  } finally {
    reader.releaseLock();
  }
  if (!doneEvent) throw createChatRequestError('ارتباط قبل از کامل شدن پاسخ قطع شد.', 502, { error: 'STREAM_INTERRUPTED' });
  return { kind: 'stream', done: doneEvent };
};

const createSmoothStreamAnimator = (onChange: (text: string) => void) => {
  let rendered = '';
  let pending = '';
  let timer: number | null = null;
  let finishing = false;
  let resolveFinish: (() => void) | null = null;
  const tick = () => {
    if (!pending) {
      if (finishing && resolveFinish) {
        const resolve = resolveFinish;
        resolveFinish = null;
        resolve();
      }
      if (!finishing && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      return;
    }
    const amount = Math.min(pending.length, finishing ? 24 : Math.max(1, Math.ceil(pending.length / 10)));
    rendered += pending.slice(0, amount);
    pending = pending.slice(amount);
    onChange(rendered);
  };
  const ensureTimer = () => {
    if (timer === null) timer = window.setInterval(tick, 24);
  };
  return {
    push: (text: string) => {
      pending += text;
      ensureTimer();
    },
    finish: () => {
      finishing = true;
      ensureTimer();
      return new Promise<void>((resolve) => {
        resolveFinish = () => {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          resolve();
        };
        tick();
      });
    },
    cancel: () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      pending = '';
      return rendered;
    }
  };
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

const createApiError = (
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

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENT_COUNT = 5;
const PUBLIC_SETTINGS_DEFAULTS = {
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
    const fallback =
      response.status === 429
        ? 'درخواست‌های زیادی ثبت شده است. کمی صبر کن و دوباره تلاش کن.'
        : response.status >= 500
          ? 'سرویس پیامک موقتاً در دسترس نیست. کمی بعد دوباره تلاش کن.'
          : 'ارسال کد تایید انجام نشد.';
    throw createApiError(
      payload.error?.trim() || payload.message?.trim() || fallback,
      payload.redirectTo ?? null,
      response.status,
      payload.retryAfterSeconds ?? payload.retryAfter
    );
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
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('chat_auth_token')
        ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
        : {})
    },
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
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('chat_auth_token')
          ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
          : {})
      },
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

const updateRemoteConversationTitle = async (conversationId: string, title: string) => {
  const response = await safeFetch(`/api/conversations/${encodeURIComponent(conversationId)}/title`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('chat_auth_token') ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` } : {})
    },
    credentials: 'include',
    body: JSON.stringify({ title })
  });
  if (!response.ok) {
    const payload = await parseApiError(response);
    throw new Error(payload.error === 'TITLE_REQUIRED' ? 'عنوان نمی‌تواند خالی باشد.' : payload.error === 'TITLE_TOO_LONG' ? 'عنوان حداکثر ۴۰ کاراکتر است.' : 'ذخیره عنوان انجام نشد.');
  }
  return (await response.json()) as { title: string; titleSource: 'manual' };
};

const createRemoteConversation = async (profile: UserProfile & { id?: string | number }) => {
  const response = await safeFetch('/api/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('chat_auth_token')
        ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
        : {})
    },
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

const conversationVisuals: Array<{ tone: string }> = [
  { tone: 'yellow' },
  { tone: 'indigo' },
  { tone: 'orange' },
  { tone: 'teal' },
  { tone: 'blue' }
];

const conversationVisualIcon = (index: number): IconName => {
  const icons: IconName[] = ['book', 'star', 'companion', 'sparkle', 'question'];
  return icons[index % icons.length];
};

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
    typeof window === 'undefined' ? 'chat' : getAppViewFromPath(window.location.pathname)
  );
  const [hasCheckedSession, setHasCheckedSession] = useState(false);
  const [hasCookieSession, setHasCookieSession] = useState(false);

  useEffect(() => {
    if (!hasCheckedSession || currentView === 'chat') return;
    const frame = window.requestAnimationFrame(() => {
      const destination = document.querySelector<HTMLElement>(`.chat-shell.view-${currentView} main`);
      if (!destination) return;
      destination.tabIndex = -1;
      destination.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentView, hasCheckedSession]);
  const [vianaEnabled, setVianaEnabled] = useState(false);
  const [vianaRedirecting, setVianaRedirecting] = useState(false);
  const [vianaNotice, setVianaNotice] = useState<AuthNotice | undefined>();
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
  const [verificationRetrySeconds, setVerificationRetrySeconds] = useState(0);
  const [errors, setErrors] = useState<{ name?: string; age?: string; phone?: string; code?: string }>({});

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [hasHydratedRemoteConversations, setHasHydratedRemoteConversations] = useState(false);
  const [conversationLoadingId, setConversationLoadingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(getInitialSidebarState);

  const handleToggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (isDesktopChatLayout()) {
        try {
          localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? 'false' : 'true');
        } catch {
          // ignore
        }
      }
      return next;
    });
  };
  const [conversationSearchTerm, setConversationSearchTerm] = useState('');
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearchActiveIndex, setConversationSearchActiveIndex] = useState(-1);
  const conversationSearchInputRef = useRef<HTMLInputElement>(null);
  const conversationSearchToggleRef = useRef<HTMLButtonElement>(null);
  const chatSidebarToggleRef = useRef<HTMLButtonElement>(null);

  const closeConversationSearch = () => {
    setConversationSearchOpen(false);
    setConversationSearchTerm('');
    setConversationSearchActiveIndex(-1);
    window.requestAnimationFrame(() => conversationSearchToggleRef.current?.focus());
  };

  useEffect(() => {
    if (!conversationSearchOpen) return;

    const focusFrame = window.requestAnimationFrame(() => conversationSearchInputRef.current?.focus());
    setConversationSearchActiveIndex(-1);
    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [conversationSearchOpen]);

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsAuthModal, setShowSettingsAuthModal] = useState(false);
  const [profileFormName, setProfileFormName] = useState('');
  const [profileFormAge, setProfileFormAge] = useState('');
  const [profileFormErrors, setProfileFormErrors] = useState<{ name?: string; age?: string }>({});
  const [, setTheme] = useState<'energy' | 'calm'>('energy');
  const { notify, confirm } = useNotification();

  useEffect(() => {
    if (verificationRetrySeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setVerificationRetrySeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [verificationRetrySeconds]);

  const [inputValue, setInputValue] = useState(() => {
    if (typeof window === 'undefined') return '';
    return readSessionValue(getChatDraftKey(getConversationIdFromPath(window.location.pathname)));
  });
  const [, setIsMobileKeyboardOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
 const [isSending, setIsSending] = useState(false);
 const [waitingTextIndex, setWaitingTextIndex] = useState(0);
 const [isRecording, setIsRecording] = useState(false);
 const [showImageGenModal, setShowImageGenModal] = useState(false);
 const [returnToChatAfterAuth, setReturnToChatAfterAuth] = useState(false);
 const [imageGenPrompt, setImageGenPrompt] = useState('');
 const [isGeneratingImage, setIsGeneratingImage] = useState(false);
 const [imageGenStatus, setImageGenStatus] = useState<string>('');
 const [imageGenError, setImageGenError] = useState<string>('');
 const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
 const [publicSettings, setPublicSettings] = useState<PublicSettings>(PUBLIC_SETTINGS_DEFAULTS);

 const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [conversationMenu, setConversationMenu] = useState<{
    conversationId: string;
    top: number;
    left: number;
  } | null>(null);

  // Detect stale session: logged in but missing JWT token (from before the token-save fix)
  const hasAuthToken = hasCookieSession || (() => {
    try { return !!localStorage.getItem('chat_auth_token'); } catch { return false; }
  })();
  const noaWallet = useNoaWallet(Boolean(profile?.id && hasAuthToken));
  const [noaRefreshVersion, setNoaRefreshVersion] = useState(0);
  const noaNotificationUserRef = useRef<string | null>(null);

  const refreshNoaWorkspace = async () => {
    await noaWallet.refresh();
    setNoaRefreshVersion((current) => current + 1);
  };

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1200px)');
    const syncSidebar = (event: MediaQueryListEvent | MediaQueryList) => {
      setSidebarOpen(event.matches && getAppViewFromPath(window.location.pathname) === 'chat');
    };
    media.addEventListener('change', syncSidebar);
    return () => media.removeEventListener('change', syncSidebar);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || isDesktopChatLayout() || currentView !== 'chat') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#chat-history-sidebar .conversation-new-chat-btn')?.focus();
    });
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('#conversation-context-menu')) return;
        event.preventDefault();
        setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
      chatSidebarToggleRef.current?.focus();
    };
  }, [currentView, sidebarOpen]);

  useEffect(() => {
    const userKey = profile?.id ? String(profile.id) : '';
    if (!userKey || !hasAuthToken || noaNotificationUserRef.current === userKey) return;
    noaNotificationUserRef.current = userKey;
    let active = true;
    const deliverNoaNotifications = () => {
      void fetchPendingNoaNotifications()
        .then((items) => {
          if (active) items.forEach((item) => notify.info(item.message, { title: 'مدیریت نوآ' }));
        })
        .catch(() => {
          // Notifications are supplementary; a temporary failure must not block chat.
        });
    };
    deliverNoaNotifications();
    const intervalId = window.setInterval(deliverNoaNotifications, 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (noaNotificationUserRef.current === userKey) noaNotificationUserRef.current = '';
    };
  }, [hasAuthToken, profile?.id, notify]);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordingActionRef = useRef<RecordingAction>('idle');
  const transcriptRef = useRef('');
  const keepRecordingRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const activeStreamRef = useRef<{
    controller: AbortController;
    conversationId: string;
    messageId: string;
    animator: ReturnType<typeof createSmoothStreamAnimator>;
    stoppedByUser: boolean;
  } | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const botMessageRef = useRef<HTMLDivElement | null>(null);
  const prevIsSendingRef = useRef(false);
  const messagesContainerRef = useRef<HTMLElement | null>(null);
  const inputAreaRef = useRef<HTMLElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentBoxRef = useRef<HTMLDivElement | null>(null);
  const conversationMenuRef = useRef<HTMLDivElement | null>(null);
  const conversationMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const attachmentUrlsRef = useRef<Set<string>>(new Set());
  const imageTaskPollingRef = useRef<Set<string>>(new Set());
  const preserveDraftDuringSendRef = useRef(false);
  const lastVisualViewportHeightRef = useRef(0);
  const keyboardDismissedWhileFocusedRef = useRef(false);

  useEffect(() => {
    if (currentView !== 'chat' || preserveDraftDuringSendRef.current) {
      return;
    }
    setInputValue(readSessionValue(getChatDraftKey(activeConversationId)));
  }, [activeConversationId, currentView]);

  useEffect(() => {
    if (currentView !== 'chat' || (preserveDraftDuringSendRef.current && !inputValue)) {
      return;
    }
    writeSessionValue(getChatDraftKey(activeConversationId), inputValue);
  }, [activeConversationId, currentView, inputValue]);

  // Mobile browsers resize the VisualViewport when their software keyboard is
  // shown. This keeps the bottom switcher out of the keyboard's way while
  // leaving desktop and tablet layouts untouched.
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const viewport = window.visualViewport;
    lastVisualViewportHeightRef.current = viewport?.height ?? window.innerHeight;

    const updateKeyboardState = () => {
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const keyboardHeight = viewport
        ? window.innerHeight - viewportHeight - viewport.offsetTop
        : 0;
      const textareaHasFocus = document.activeElement === messageInputRef.current;
      const viewportHasExpanded = viewportHeight - lastVisualViewportHeightRef.current > 80;
      lastVisualViewportHeightRef.current = viewportHeight;

      if (!mobileQuery.matches || !textareaHasFocus) {
        keyboardDismissedWhileFocusedRef.current = false;
        setIsMobileKeyboardOpen(false);
        return;
      }

      if (keyboardHeight > 150) {
        keyboardDismissedWhileFocusedRef.current = false;
      } else if (viewportHasExpanded) {
        // Android can keep the textarea focused after its Back button closes
        // the keyboard. A growing visual viewport is the reliable close cue.
        keyboardDismissedWhileFocusedRef.current = true;
      }

      setIsMobileKeyboardOpen(!keyboardDismissedWhileFocusedRef.current);
    };

    updateKeyboardState();
    mobileQuery.addEventListener('change', updateKeyboardState);
    window.addEventListener('resize', updateKeyboardState);
    viewport?.addEventListener('resize', updateKeyboardState);
    viewport?.addEventListener('scroll', updateKeyboardState);

    return () => {
      mobileQuery.removeEventListener('change', updateKeyboardState);
      window.removeEventListener('resize', updateKeyboardState);
      viewport?.removeEventListener('resize', updateKeyboardState);
      viewport?.removeEventListener('scroll', updateKeyboardState);
    };
  }, []);

  // Resize from the rendered content rather than newline count. This keeps a
  // wrapped mobile message fully visible while preserving a compact single row
  // when the same text fits on desktop.
  useLayoutEffect(() => {
    const textarea = messageInputRef.current;
    if (currentView !== 'chat' || !textarea) return;

    textarea.style.height = 'auto';
    const maxHeight = 132;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [currentView, inputValue]);

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

  useEffect(() => {
    if (!imagePreview) {
      return;
    }

    const images = visibleMessages.reduce<string[]>((acc, msg) => {
      if (Array.isArray(msg.images)) {
        msg.images.forEach((img) => { if (img?.url) acc.push(img.url); });
      }
      return acc;
    }, []);
    const uniqueImages = [...new Set(images)];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImagePreview(null);
        return;
      }
      if (uniqueImages.length < 2) return;
      const currentIndex = uniqueImages.indexOf(imagePreview.src);
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? (currentIndex - 1 + uniqueImages.length) % uniqueImages.length : 0;
        const src = uniqueImages[nextIndex];
        setImagePreview({ src, alt: 'تصویر', downloadName: buildImageDownloadName(src, nextIndex) });
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % uniqueImages.length : 0;
        const src = uniqueImages[nextIndex];
        setImagePreview({ src, alt: 'تصویر', downloadName: buildImageDownloadName(src, nextIndex) });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview, visibleMessages]);

  const orderedConversations = useMemo(() => sortConversations(conversations), [conversations]);
  const visibleConversations = useMemo(() => {
    const query = conversationSearchTerm.trim().toLocaleLowerCase('fa-IR');
    return orderedConversations
      .map((conversation, index) => ({ conversation, index }))
      .filter(({ conversation }) => {
        if (!query) return true;
        const searchableText = `${conversation.title || DEFAULT_TITLE} ${getConversationPreview(conversation)}`.toLocaleLowerCase('fa-IR');
        return searchableText.includes(query);
      });
  }, [conversationSearchTerm, orderedConversations]);
  const sidebarPinnedConversations = useMemo(
    () => visibleConversations.filter(({ conversation }) => conversation.pinned),
    [visibleConversations]
  );
  const sidebarUnpinnedConversations = useMemo(
    () => visibleConversations.filter(({ conversation }) => !conversation.pinned),
    [visibleConversations]
  );
  const sidebarToday = useMemo(
    () =>
      sidebarUnpinnedConversations.filter(({ conversation }) => {
        const date = new Date(conversation.updatedAt || conversation.createdAt);
        const now = new Date();
        return date.toDateString() === now.toDateString();
      }),
    [sidebarUnpinnedConversations]
  );
  const sidebarOlder = useMemo(
    () =>
      sidebarUnpinnedConversations.filter(({ conversation }) => {
        const date = new Date(conversation.updatedAt || conversation.createdAt);
        const now = new Date();
        return date.toDateString() !== now.toDateString();
      }),
    [sidebarUnpinnedConversations]
  );
  const conversationMenuTarget = conversationMenu
    ? conversations.find((conversation) => conversation.id === conversationMenu.conversationId) || null
    : null;

  useEffect(() => {
    if (!activeConversationId) {
      setConversationLoadingId(null);
      return;
    }
    const conversation = conversations.find((c) => c.id === activeConversationId);
    if (conversation) {
      setConversationLoadingId(null);
      return;
    }
    setConversationLoadingId(activeConversationId);
    const timeout = setTimeout(() => setConversationLoadingId(null), 3000);
    return () => clearTimeout(timeout);
  }, [activeConversationId, conversations]);

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
        src={BOT_AVATAR_FALLBACK_URL}
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
    const nextPath = view === 'studio'
        ? '/studio'
        : view === 'video'
          ? '/studio/video'
          : view === 'images'
            ? '/images'
            : view === 'profile'
              ? '/profile'
              : view === 'noa'
                ? '/noa'
                : '/';
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      if (mode === 'replace') {
        window.history.replaceState({}, '', nextPath);
      } else {
        window.history.pushState({}, '', nextPath);
      }
    }
    setCurrentView(view);
    setSidebarOpen((current) => view === 'chat' ? (isDesktopChatLayout() || current) : false);
  };

  const navigateToConversation = (conversationId: string, mode: 'push' | 'replace' = 'push') => {
    const nextPath = conversationId ? `/c/${encodeURIComponent(conversationId)}` : '/';
    mode === 'replace' ? window.history.replaceState({}, '', nextPath) : window.history.pushState({}, '', nextPath);
    setCurrentView('chat');
    setActiveConversationId(conversationId);
    if (!isDesktopChatLayout()) setSidebarOpen(false);
  };

  const openStudioFromChat = () => {
    const pathname = window.location.pathname;
    const routeConversationId = getConversationIdFromPath(pathname);
    const chatPath = pathname === '/' || routeConversationId ? pathname : '/';
    const draftConversationId = routeConversationId || activeConversationId;
    writeSessionValue(getChatDraftKey(draftConversationId), inputValue);
    writeSessionValue(LAST_STUDIO_CHAT_PATH_KEY, chatPath);

    const previousState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    window.history.pushState({ ...previousState, danaoStudioReturnPath: chatPath }, '', '/studio');
    setCurrentView('studio');
    setSidebarOpen(false);
  };

  const openImageStudioFromStudio = () => {
    window.history.pushState({}, '', '/studio/image');
    setCurrentView('images');
    setSidebarOpen(false);
  };

  const openVideoStudio = () => {
    window.history.pushState({}, '', '/studio/video');
    setCurrentView('video');
    setSidebarOpen(false);
  };

  const returnToStudio = () => {
    navigateToView('studio');
  };

  const returnToChatFromStudio = () => {
    const statePath = window.history.state?.danaoStudioReturnPath;
    const isChatPath = (path: unknown): path is string =>
      typeof path === 'string' && (path === '/' || /^\/c\/[^/]+$/.test(path));
    const returnPath = isChatPath(statePath) ? statePath : '/';

    writeSessionValue(LAST_STUDIO_CHAT_PATH_KEY, '');
    navigateToConversation(getConversationIdFromPath(returnPath), 'replace');
  };

  const handleBackToHome = () => {
    if (currentView === 'chat') {
      setSidebarOpen((open) => !open);
      return;
    }
    navigateToView('chat');
  };

  const handleOpenNoaWallet = () => {
    navigateToView('noa');
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

  const handleOpenSettings = () => {
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
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const authParam = new URLSearchParams(window.location.search).get('auth');
        const requestedAuthMode: AuthMode | null = authParam === 'login' || authParam === 'signup' ? authParam : null;
        removeLegacyLocalDevelopmentCredentials();
        const rawProfiles = localStorage.getItem(PROFILES_KEY);
        const rawConversations = localStorage.getItem(CONVERSATIONS_KEY);
        const routeConversationId = getConversationIdFromPath(window.location.pathname);
        const storedAuthToken = localStorage.getItem('chat_auth_token') || '';
        const [serverSession, providerConfig] = await Promise.all([
          loadDanoaSession(storedAuthToken).catch(() => ({ authenticated: false } as DanoaSessionResponse)),
          loadVianaConfig().catch(() => ({ enabled: false, providerLabel: 'Viana' }))
        ]);
        if (cancelled) return;
        setVianaEnabled(providerConfig.enabled);
        if (serverSession.authNotice) setVianaNotice(serverSession.authNotice);

        if (rawProfiles) {
          const parsedProfiles = JSON.parse(rawProfiles) as AppProfile[];
          if (Array.isArray(parsedProfiles) && parsedProfiles.length > 0) setHasSavedAccount(true);
        }

        let profileData = loadProfile();
        const routeView = getAppViewFromPath(window.location.pathname);
        if (serverSession.authenticated && serverSession.profile && serverSession.userId) {
          profileData = {
            ...serverSession.profile,
            id: serverSession.userId,
            authProvider: serverSession.provider,
            personality: profileData?.personality || createDefaultPersonality()
          };
          localStorage.setItem(PROFILE_KEY, JSON.stringify(profileData));
          if (serverSession.provider === 'viana' && serverSession.authMethods?.includes('session')) {
            localStorage.removeItem('chat_auth_token');
            setHasCookieSession(true);
            setSessionCsrfToken(serverSession.csrfToken);
          } else {
            setHasCookieSession(false);
            clearSessionCsrfToken();
          }
        }

        const savedTheme = localStorage.getItem(THEME_KEY) as 'energy' | 'calm' | null;
        if (savedTheme === 'energy' || savedTheme === 'calm') applyTheme(savedTheme, false);
        else if (profileData) applyTheme(getDefaultThemeByAge(profileData.age), false);
        else applyTheme('energy', false);

        if (serverSession.authenticated && profileData) {
          setProfile(profileData);
          setLandingStep('chat');
          setCurrentView(routeView);
          setSidebarOpen(routeView === 'chat' && isDesktopChatLayout());
          setHasSavedAccount(true);
        } else if (requestedAuthMode === 'login') {
          setAuthMode('login');
          setRegistrationStep(1);
          setLandingStep('login');
        } else if (requestedAuthMode === 'signup') {
          setAuthMode('signup');
          setRegistrationStep(1);
          setLandingStep('signup');
        } else {
          if (profileData && !storedAuthToken) localStorage.removeItem(PROFILE_KEY);
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
            setActiveConversationId(
              routeConversationId && sorted.some((item) => item.id === routeConversationId) ? routeConversationId : ''
            );
            return;
          }
        }
        setConversations([]);
        setActiveConversationId('');
      } catch {
        setConversations([]);
        setActiveConversationId('');
      } finally {
        if (!cancelled) setHasCheckedSession(true);
      }
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!profile || !vianaNotice || vianaNotice === 'success') return;
    const message = authNoticeMessage(vianaNotice);
    if (message) {
      if (message.variant === 'error') notify.error(message.text);
      else notify.info(message.text);
    }
    setVianaNotice(undefined);
  }, [profile, notify, vianaNotice]);

  useEffect(() => {
    const refreshVianaAvailability = () => {
      void loadVianaConfig()
        .then((providerConfig) => setVianaEnabled(providerConfig.enabled))
        .catch(() => setVianaEnabled(false));
    };
    window.addEventListener('focus', refreshVianaAvailability);
    return () => window.removeEventListener('focus', refreshVianaAvailability);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const pathname = window.location.pathname;
      if (pathname === '/' || pathname === '/chat' || /^\/c\/[^/]+$/.test(pathname) || pathname === '/studio' || pathname === '/studio/image' || pathname === '/studio/video' || pathname === '/images' || pathname === '/generate' || pathname === '/photos' || pathname === '/profile' || pathname === '/settings' || pathname === '/noa') {
        const nextView = getAppViewFromPath(pathname);
        setCurrentView(nextView);
        setActiveConversationId(getConversationIdFromPath(pathname));
        setSidebarOpen(nextView === 'chat' && isDesktopChatLayout());
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
        const routeConversationId = getConversationIdFromPath(window.location.pathname);
        setActiveConversationId(routeConversationId && sorted.some((item) => item.id === routeConversationId) ? routeConversationId : '');
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(sorted));
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

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttachmentMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [attachmentMenuOpen]);

  useEffect(() => {
    if (!conversationMenu) return;

    const focusFrame = window.requestAnimationFrame(() => {
      conversationMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
    });
    const closeMenu = () => setConversationMenu(null);
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        conversationMenuRef.current?.contains(target) ||
        conversationMenuTriggerRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const trigger = conversationMenuTriggerRef.current;
      closeMenu();
      window.setTimeout(() => trigger?.focus(), 0);
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [conversationMenu]);

  useEffect(() => {
    if (sidebarOpen && currentView === 'chat') return;
    setConversationMenu(null);
  }, [currentView, sidebarOpen]);

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
      notify.error(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'اجازه دسترسی به میکروفن داده نشد. لطفاً دسترسی میکروفن را در مرورگر فعال کن.'
          : 'دسترسی به میکروفن برقرار نشد. لطفاً دوباره تلاش کن.'
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
          notify.warning('ضبط برای مدت طولانی ادامه پیدا نکرد. لطفاً دوباره تلاش کن.');
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
        // Keep the recognised text as a draft so the user can review or edit it
        // before explicitly sending it from the message composer.
        window.requestAnimationFrame(() => messageInputRef.current?.focus());
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
  }, [notify]);

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

  const saveManualTitle = async (conversationId: string, value: string) => {
    const title = value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) {
      notify.warning('عنوان نمی‌تواند خالی باشد.');
      return false;
    }
    if (title.length > 40) {
      notify.warning('عنوان حداکثر ۴۰ کاراکتر است.');
      return false;
    }
    try {
      const result = await updateRemoteConversationTitle(conversationId, title);
      updateConversation(conversationId, (item) => ({ ...item, title: result.title, updatedAt: new Date().toISOString() }));
      return true;
    } catch (error) {
      notify.warning(error instanceof Error ? error.message : 'ذخیره عنوان انجام نشد.');
      return false;
    }
  };

  const finishTitleEdit = async (conversationId: string, commit: boolean) => {
    if (commit) await saveManualTitle(conversationId, editingTitle);
    setEditingId(null);
  };

  const refreshConversationTitle = async (conversationId: string) => {
    if (!profile?.id) return;
    try {
      const payload = await loadRemoteConversations(profile);
      const remote = (payload.items || []).find((item) => item.conversation_id === conversationId);
      if (remote?.title?.trim()) {
        updateConversation(conversationId, (item) => ({ ...item, title: remote.title!.trim() }));
      }
    } catch {
      // A later ordinary conversation load will pick up a title that completed after streaming.
    }
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
      navigateToConversation(created.id, 'replace');
      return created;
    } catch (error) {
      notify.warning(error instanceof Error ? error.message : 'ساخت گفتگوی جدید انجام نشد.');
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
          notify.success('عکس با موفقیت ساخته شد');
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
          notify.error(errorMessage);
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
      navigateToView('chat', 'replace');
      return;
    }
    if (shouldReturnToSettings) {
      setShowSettingsAuthModal(false);
      setShowProfileModal(false);
      navigateToView('profile', 'replace');
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
      const requestError = error as ApiError;
      if (requestError.status === 429) {
        setVerificationRetrySeconds(requestError.retryAfterSeconds || 60);
      }
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

  const executeStreamingChat = async ({
    payload,
    retryPayload
  }: {
    payload: ChatStreamPayload;
    retryPayload: NonNullable<ChatMessage['retryPayload']>;
  }) => {
    const controller = new AbortController();
    const assistantMessageId = `${payload.turnId}-assistant`;
    const patchAssistant = (patch: Partial<ChatMessage>) => {
      updateConversation(retryPayload.conversationId, (item) => ({
        ...item,
        messages: item.messages.map((entry) => entry.id === assistantMessageId ? { ...entry, ...patch } : entry),
        updatedAt: new Date().toISOString()
      }));
    };
    const animator = createSmoothStreamAnimator((text) => patchAssistant({ content: text }));
    activeStreamRef.current = {
      controller,
      conversationId: retryPayload.conversationId,
      messageId: assistantMessageId,
      animator,
      stoppedByUser: false
    };

    try {
      return await postChatStream(payload, controller.signal, async (event) => {
        if (event.type === 'meta') {
          updateConversation(retryPayload.conversationId, (item) => {
            const existing = item.messages.some((entry) => entry.id === assistantMessageId);
            const streamMessage: ChatMessage = {
              id: assistantMessageId,
              role: 'assistant',
              type: 'text',
              intent: event.intent || 'chat',
              content: '',
              timestamp: new Date().toISOString(),
              streamStatus: 'streaming',
              imageStudioRedirect: Boolean(event.imageStudioRedirect),
              turnId: payload.turnId,
              attemptId: payload.attemptId,
              retryPayload
            };
            return {
              ...item,
              messages: existing
                ? item.messages.map((entry) => entry.id === assistantMessageId ? { ...entry, ...streamMessage } : entry)
                : [...item.messages, streamMessage],
              updatedAt: new Date().toISOString()
            };
          });
        } else if (event.type === 'delta' && event.delta) {
          animator.push(event.delta);
        } else if (event.type === 'done') {
          await animator.finish();
          patchAssistant({
            content: event.reply || undefined,
            streamStatus: 'completed',
            attemptId: event.attemptId,
            imageStudioRedirect: Boolean(event.imageStudioRedirect),
            streamError: undefined
          });
          // One bounded refetch covers a title that finished just after the NDJSON stream;
          // it is deliberately not a polling loop.
          window.setTimeout(() => { void refreshConversationTitle(retryPayload.conversationId); }, 3500);
        } else if (event.type === 'title' && event.title?.trim()) {
          updateConversation(retryPayload.conversationId, (item) => ({ ...item, title: event.title!.trim() }));
        } else if (event.type === 'error') {
          animator.cancel();
          patchAssistant({ streamStatus: 'failed', streamError: event.message || 'دریافت پاسخ ناموفق بود.' });
        }
      });
    } catch (error) {
      const active = activeStreamRef.current;
      if ((error instanceof DOMException && error.name === 'AbortError') || controller.signal.aborted) {
        const content = animator.cancel();
        patchAssistant({
          ...(content ? { content } : {}),
          streamStatus: active?.stoppedByUser ? 'cancelled' : 'failed',
          streamError: active?.stoppedByUser ? 'پاسخ با درخواست شما متوقف شد.' : 'ارتباط هنگام دریافت پاسخ قطع شد.'
        });
        if (active?.stoppedByUser) return { kind: 'cancelled' as const };
      } else {
        animator.cancel();
        patchAssistant({ streamStatus: 'failed', streamError: error instanceof Error ? error.message : 'دریافت پاسخ ناموفق بود.' });
      }
      if (error instanceof Error) (error as Error & { streamHandled?: boolean }).streamHandled = true;
      throw error;
    } finally {
      if (activeStreamRef.current?.controller === controller) activeStreamRef.current = null;
    }
  };

  const handleStopResponse = () => {
    const active = activeStreamRef.current;
    if (!active) return;
    active.stoppedByUser = true;
    active.controller.abort();
  };

  const handleRetryStreamMessage = async (failedMessage: ChatMessage) => {
    const retryPayload = failedMessage.retryPayload;
    if (!profile || !failedMessage.turnId || !retryPayload || isSending || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setIsSending(true);
    const attemptId = `attempt-${crypto.randomUUID()}`;
    try {
      await executeStreamingChat({
        payload: {
          ...retryPayload,
          profile,
          personality: normalizePersonality(profile.personality),
          turnId: failedMessage.turnId,
          attemptId
        },
        retryPayload
      });
    } catch (error) {
      if (!(error instanceof Error && (error as Error & { streamHandled?: boolean }).streamHandled)) {
        notify.warning(error instanceof Error ? error.message : 'تلاش مجدد ناموفق بود.');
      }
    } finally {
      sendInFlightRef.current = false;
      setIsSending(false);
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
      content: content || 'تصویر ارسال شد',
      timestamp: new Date().toISOString(),
      images: previewImages.length > 0 ? previewImages : undefined
    };

    const updatedMessages = [...currentConversation.messages, userMessage];
    updateConversation(currentConversation.id, (item) => ({
      ...item,
      messages: updatedMessages,
      updatedAt: new Date().toISOString()
    }));

    preserveDraftDuringSendRef.current = true;
    let sentSuccessfully = false;
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
          notify.error('آپلود تصویر ناموفق: خطای شبکه');
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
          notify.error(`آپلود تصویر ناموفق: ${String(uploadError)}`);
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
          notify.error('آپلود تصویر ناموفق: شناسه تصویر دریافت نشد.');
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

      const turnId = `turn-${crypto.randomUUID()}`;
      const attemptId = `attempt-${crypto.randomUUID()}`;
      const retryPayload: NonNullable<ChatMessage['retryPayload']> = {
        message: content,
        imageIds: uploadedImageIds,
        history: currentConversation.messages.slice(-30).map((item) => ({
          id: item.id,
          role: item.role,
          type: item.type,
          intent: item.intent,
          content: item.content,
          timestamp: item.timestamp,
          taskId: item.taskId,
          status: item.status,
          images: item.images
        })),
        conversationId: currentConversation.id,
        clientMessageId: userMessage.id || generateMessageId('user')
      };
      const chatResult = await executeStreamingChat({
        payload: {
          ...retryPayload,
          profile: nextProfile,
          personality: nextPersonality,
          turnId,
          attemptId
        },
        retryPayload
      });
      sentSuccessfully = true;
      if (chatResult.kind === 'cancelled' || chatResult.kind === 'stream') return;
      const { data } = chatResult;
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
          notify.warning(data.assistantText || 'ساخت عکس ناموفق بود');
        } else if (imageTaskId) {
          updateImageTaskMessage(currentConversation.id, imageTaskId, {
            type: 'image_loading',
            intent: data.intent,
            content: data.assistantText || 'درخواست ساخت تصویر ثبت شد. در حال ساخت تصویر...',
            status: data.status || 'QUEUE',
            taskId: imageTaskId
          });
          void pollImageTask(currentConversation.id, imageTaskId, content || 'تصویر ساخته شده');
          notify.success('درخواست ساخت تصویر ثبت شد');
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
          notify.warning(data.assistantText || 'خواندن تصویر ناموفق بود');
        }
        return;
      }

      const replyText = data.reply?.trim() || data.assistantText?.trim() || 'الان نتوانستم پاسخ بدهم. لطفاً دوباره امتحان کن.';

      const botMessage: ChatMessage = {
        id: generateMessageId('assistant'),
        role: 'assistant',
        type: 'text',
        content: replyText,
        imageStudioRedirect: Boolean(data.imageStudioRedirect),
        timestamp: new Date().toISOString()
      };

      updateConversation(currentConversation.id, (item) => ({
        ...item,
        messages: [...item.messages, botMessage],
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      const requestError = error as ChatRequestError;
      const isInsufficientBalance =
        requestError.payload?.error === 'NOA_INSUFFICIENT_FUNDS' ||
        requestError.payload?.error === 'NOA_INSUFFICIENT_BALANCE' ||
        (requestError.status === 402 && !requestError.payload?.error);
      if (isInsufficientBalance) {
        const billingMessage: ChatMessage = {
          id: generateMessageId('assistant-billing'),
          role: 'assistant',
          type: 'text',
          content: '',
          timestamp: new Date().toISOString(),
          billingError: {
            kind: 'insufficient_balance',
            actionKey: requestError.payload?.actionKey,
            balanceNoa: requestError.payload?.balanceNoa,
            requiredNoa: requestError.payload?.requiredNoa,
            shortfallNoa: requestError.payload?.shortfallNoa,
            retryable: Boolean(content && attachmentsAtSend.length === 0),
            retryMessage: content || undefined
          }
        };
        updateConversation(currentConversation.id, (item) => {
          return {
            ...item,
            messages: [...item.messages, billingMessage],
            updatedAt: new Date().toISOString()
          };
        });
        setInputValue(content);
        notify.warning('موجودی نوآ برای این درخواست کافی نیست؛ جزئیات و راه‌حل در گفتگو نمایش داده شد.');
        void noaWallet.refresh();
        return;
      }

      if (error instanceof Error && (error as Error & { streamHandled?: boolean }).streamHandled) {
        notify.warning('پاسخ کامل نشد؛ برای تلاش دوباره روی آیکون کنار پیام بزن.');
        return;
      }

      if (requestError.status === 401 || requestError.payload?.error === 'AUTHENTICATION_REQUIRED') {
        setInputValue(content);
        setReturnToChatAfterAuth(true);
        beginAuthFlow('login');
        setShowSettingsAuthModal(true);
        return;
      }

      const isNetworkError = error instanceof Error && error.message.includes('اتصال به سرور');
      const isTimeoutError = error instanceof Error && error.message.includes('بیش از حد طول کشید');

      const fallbackText =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'یه مشکل کوچولو پیش اومد. چند لحظه دیگه دوباره تلاش می کنیم.';
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: fallbackText,
        timestamp: new Date().toISOString()
      };

      const toastMessage =
        isNetworkError ? 'خطای شبکه — لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید' :
        isTimeoutError ? 'درخواست بیش از حد طول کشید. لطفاً دوباره تلاش کنید' :
        'خطا در دریافت پاسخ — لطفاً دوباره تلاش کنید';
      if (isNetworkError || isTimeoutError) {
        notify.warning(toastMessage);
      } else {
        notify.error(toastMessage);
      }

      updateConversation(currentConversation.id, (item) => ({
        ...item,
        messages: [...item.messages, errorMessage],
        updatedAt: new Date().toISOString()
      }));
    } finally {
      if (sentSuccessfully) {
        writeSessionValue(CHAT_DRAFT_NEW_KEY, '');
        writeSessionValue(getChatDraftKey(currentConversation.id), '');
      } else {
        setInputValue((currentValue) => currentValue || content);
      }
      preserveDraftDuringSendRef.current = false;
      sendInFlightRef.current = false;
      setIsSending(false);
      setAttachmentMenuOpen(false);
    }
  };

  const handlePickImageClick = () => {
    setAttachmentMenuOpen(false);
    imageInputRef.current?.click();
  };

  const handleAttachmentMenuToggle = () => {
    setAttachmentMenuOpen((isOpen) => !isOpen);
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
        notify.error(`فرمت ${file.name} مجاز نیست.`);
        continue;
      }
      if (file.size > uploadMaxSizeBytes) {
        notify.error(`حجم ${file.name} بیشتر از ${new Intl.NumberFormat('fa-IR').format(uploadMaxSizeMb)} مگابایت است.`);
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
        notify.warning(`حداکثر ${new Intl.NumberFormat('fa-IR').format(uploadMaxFiles)} عکس قابل انتخاب است. فقط ${new Intl.NumberFormat('fa-IR').format(uploadMaxFiles)} مورد اول نگه داشته شد.`);
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
      notify.error('آپلود تصویر ناموفق. لطفاً دوباره تلاش کنید.');
    }
  };

  useEffect(() => {
    return () => {
      attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlsRef.current.clear();
    };
  }, []);

  const handleCreateConversation = async () => {
    setActiveConversationId('');
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    if (!isDesktopChatLayout()) setSidebarOpen(false);
    setInputValue('');
    navigateToConversation('');
  };

  const handleConversationMenuToggle = (
    event: React.MouseEvent<HTMLButtonElement>,
    conversationId: string
  ) => {
    event.stopPropagation();
    if (conversationMenu?.conversationId === conversationId) {
      setConversationMenu(null);
      return;
    }

    const trigger = event.currentTarget;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = 208;
    const menuHeight = 168;
    const viewportPadding = 12;
    const preferredLeft = triggerRect.right + 8;
    const left = Math.min(
      window.innerWidth - menuWidth - viewportPadding,
      Math.max(viewportPadding, preferredLeft)
    );
    const top = Math.min(
      window.innerHeight - menuHeight - viewportPadding,
      Math.max(viewportPadding, triggerRect.top - 4)
    );

    conversationMenuTriggerRef.current = trigger;
    setConversationMenu({ conversationId, top, left });
  };

  const handleConversationMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')
    );
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') {
      items[0].focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1].focus();
      return;
    }
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  };

  const handleDeleteConversation = async (conversationId: string) => {
    const target = conversations.find((item) => item.id === conversationId);
    if (!target) {
      return;
    }

    const allowed = await confirm({
      message: `«${target.title}» حذف شود؟`,
      confirmText: 'حذف',
      cancelText: 'انصراف',
      variant: 'danger'
    });
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

  const handleDeleteAllConversations = async () => {
    const confirmed = await confirm({
      message: 'همه گفتگوها حذف شوند؟ این عمل قابل بازگشت نیست.',
      confirmText: 'حذف همه',
      cancelText: 'انصراف',
      variant: 'danger'
    });
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
      notify.warning('گفتگوی فعالی برای ذخیره وجود ندارد.');
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

  const handleLogout = async () => {
    const confirmed = await confirm({
      message: 'از حساب خارج می شوی؟ همه اطلاعات گفتگو پاک می شود.',
      confirmText: 'خروج',
      cancelText: 'انصراف',
      variant: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      await safeFetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(localStorage.getItem('chat_auth_token')
            ? { Authorization: `Bearer ${localStorage.getItem('chat_auth_token')}` }
            : {})
        }
      });
    } catch {
      // Local browser cleanup still completes; the server session expires independently.
    }

    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(CONVERSATIONS_KEY);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    localStorage.removeItem('chat_auth_token');
    clearSessionCsrfToken();
    setHasCookieSession(false);

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
      notify.warning('مرورگر تو از ضبط صدا پشتیبانی نمی کند.');
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
      notify.error(message);
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

 const handleCloseImageGenerator = () => {
   setShowImageGenModal(false);
   setImageGenError('');
   setImageGenStatus('');
 };

 const handleGenerateImageSubmit = async () => {
   const prompt = imageGenPrompt.trim();
   if (!prompt) {
notify.error('لطفاً توضیح عکس را بنویس');
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

     updateConversation(currentConversation.id, (item) => ({
       ...item,
       messages: dedupeChatMessages([...item.messages, userMessage]),
       updatedAt: new Date().toISOString()
     }));

     const { taskId } = await startImageGeneration(prompt, { conversationId: currentConversation.id });
     updateImageTaskMessage(currentConversation.id, taskId, {
       type: 'image_loading',
       intent: 'image_generation',
       content: 'درخواست ساخت تصویر ثبت شد. در حال ساخت تصویر...',
       status: 'QUEUE',
       taskId
     });
     void pollImageTask(currentConversation.id, taskId, prompt);
     setImageGenPrompt('');
     notify.success('درخواست ساخت تصویر ثبت شد');
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
notify.error(message);
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
        : verificationRetrySeconds > 0
          ? `تلاش دوباره تا ${verificationRetrySeconds} ثانیه`
          : 'ادامه با کد تایید';
    const notice = authNoticeMessage(vianaNotice);
    const renderVianaAction = () => (
      <div className="viana-auth-section">
        {vianaEnabled ? (
          <>
            <div className="auth-divider" aria-hidden="true">
              <span />
              <b>یا</b>
              <span />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="viana-signin-button"
              loading={vianaRedirecting}
              disabled={vianaRedirecting || isSendingVerification || isCheckingPhone || isVerifyingCode}
              onClick={() => {
                setVianaRedirecting(true);
                setVianaNotice(undefined);
                window.location.assign('/api/auth/viana/start');
              }}
            >
              ورود با Viana
            </Button>
          </>
        ) : null}
        {notice ? <InlineMessage text={notice.text} variant={notice.variant} className="viana-auth-notice" /> : null}
      </div>
    );
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
              onChange={(event) => {
                setPhone(filterLocalizedDigits(event.target.value));
                setVerificationRetrySeconds(0);
                setErrors((current) => ({ ...current, phone: undefined }));
              }}
              placeholder="09123456789"
              type="tel"
              inputMode="numeric"
              pattern="[0-9۰-۹٠-٩]*"
              maxLength={11}
              autoComplete="tel"
              helperText="کد تایید برای همین شماره پیامک می‌شود."
              errorText={errors.phone}
            />

            <Button
              type="submit"
              className="start-btn auth-primary-action"
              disabled={isSendingVerification || isCheckingPhone || verificationRetrySeconds > 0}
            >
              {authActionText}
            </Button>
            {renderVianaAction()}

            <p className="helper onboarding-help">
              {hasSavedAccount
                ? 'روی این مرورگر قبلاً حساب ذخیره شده؛ با همان شماره وارد شو.'
                : 'برای استفاده از چت، تصویر و ویدئو باید وارد حساب کاربری شوی.'}
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
              onChange={(event) => {
                setPhone(filterLocalizedDigits(event.target.value));
                setVerificationRetrySeconds(0);
                setErrors((current) => ({ ...current, phone: undefined }));
              }}
              placeholder="09123456789"
              type="tel"
              inputMode="numeric"
              pattern="[0-9۰-۹٠-٩]*"
              maxLength={11}
              autoComplete="tel"
              helperText="فرمت معتبر: 09XXXXXXXXX"
              errorText={errors.phone}
            />

            <Button
              type="submit"
              className="start-btn"
              disabled={isSendingVerification || isCheckingPhone || verificationRetrySeconds > 0}
            >
              {authActionText}
            </Button>
            {renderVianaAction()}
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

  const renderSidebarConversation = ({ conversation, index }: { conversation: Conversation; index: number }) => {
    const isActive = conversation.id === activeConversationId;
    const isEditing = editingId === conversation.id;
    const visual = conversationVisuals[index % conversationVisuals.length];
    const preview = getConversationPreview(conversation);
    const dateLabel = formatConversationDate(conversation.updatedAt || conversation.createdAt);

    return (
      <div className={`conversation-row conversation-card ${isActive ? 'active' : ''}`} key={conversation.id}>
        {!isEditing ? (
          <button
            type="button"
            className="conversation-card-select"
            onClick={() => {
              setActiveConversationId(conversation.id);
              navigateToConversation(conversation.id);
            }}
            aria-label={`باز کردن گفتگو: ${conversation.title || DEFAULT_TITLE}`}
            aria-current={isActive ? 'page' : undefined}
          />
        ) : null}
        <div className={`conversation-card-icon conversation-card-icon--${visual.tone}`} aria-hidden="true">
          <Icon name={conversationVisualIcon(index)} size="1.25em" />
        </div>
        <div className="conversation-main">
          {isEditing ? (
            <form onSubmit={(event) => { event.preventDefault(); void finishTitleEdit(conversation.id, true); }}>
              <input
                autoFocus
                className="rename-input ds-field__input"
                value={editingTitle}
                maxLength={40}
                aria-label="عنوان گفتگو"
                onBlur={() => { void finishTitleEdit(conversation.id, true); }}
                onChange={(event) => setEditingTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { event.preventDefault(); void finishTitleEdit(conversation.id, false); }
                }}
              />
            </form>
          ) : (
            <>
              <div className="conversation-card-title-row">
                <p>{conversation.title || DEFAULT_TITLE}</p>
                {conversation.pinned ? (
                  <span className="conversation-card-pinned" title="سنجاق‌شده" aria-label="سنجاق‌شده">
                    <Icon name="pin" size={13} aria-hidden="true" />
                  </span>
                ) : null}
              </div>
              <div className="conversation-card-preview-row">
                <small>{preview}</small>
                <time className="conversation-card-date" dateTime={conversation.updatedAt || conversation.createdAt}>
                  {dateLabel}
                </time>
              </div>
            </>
          )}
        </div>

        <div className="conversation-card-meta" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`conversation-more-trigger ${conversationMenu?.conversationId === conversation.id ? 'is-open' : ''}`}
            aria-label={`گزینه‌های گفتگو: ${conversation.title || DEFAULT_TITLE}`}
            aria-haspopup="menu"
            aria-expanded={conversationMenu?.conversationId === conversation.id}
            aria-controls={conversationMenu?.conversationId === conversation.id ? 'conversation-context-menu' : undefined}
            title="گزینه‌های گفتگو"
            onClick={(event) => handleConversationMenuToggle(event, conversation.id)}
          >
            <Icon name="more-horizontal" size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
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
  const isEmptyConversation = currentView === 'chat' && !conversationLoadingId && !isSending && visibleMessages.length === 0;
  const imagePromptLength = imageGenPrompt.trim().length;
  const canSubmitImagePrompt = imagePromptLength > 0 && !isGeneratingImage;
  const currentPathname = window.location.pathname;

  return (
    <div className={`app-shell chat-shell view-${currentView} ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <div className="bg-blob blob-pink" />
      <div className="bg-blob blob-orange" />
      <div className="bg-blob blob-yellow" />
      <div className="bg-blob blob-purple" />
      {currentView === 'chat' ? <a className="app-skip-link" href="#chat-messages">رفتن به پیام‌ها</a> : null}

      {currentView === 'chat' && conversationSearchOpen ? (() => {
        const searchQuery = conversationSearchTerm.trim();
        const searchModalResults = searchQuery
          ? visibleConversations
          : orderedConversations.slice(0, 7).map((conversation, index) => ({ conversation, index }));
        const handleSearchResultClick = (conversationId: string) => {
          setActiveConversationId(conversationId);
          closeConversationSearch();
          navigateToConversation(conversationId);
        };
        const handleSearchKeyDown = (event: React.KeyboardEvent) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setConversationSearchActiveIndex((prev) =>
              searchModalResults.length ? Math.min(prev + 1, searchModalResults.length - 1) : -1
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setConversationSearchActiveIndex((prev) => Math.max(prev - 1, -1));
            if (conversationSearchActiveIndex <= 0) {
              conversationSearchInputRef.current?.focus();
            }
          } else if (event.key === 'Enter' && conversationSearchActiveIndex >= 0) {
            const target = searchModalResults[conversationSearchActiveIndex];
            if (target) handleSearchResultClick(target.conversation.id);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeConversationSearch();
          }
        };
        return (
        <div
          className="conversation-search-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            closeConversationSearch();
          }}
        >
          <section
            id="conversation-search-modal"
            className="conversation-search-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversation-search-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleSearchKeyDown}
          >
            <div className="conversation-search-modal__header">
              <h2 id="conversation-search-modal-title">جست‌وجوی گفتگوها</h2>
              <button
                type="button"
                className="conversation-search-modal__close"
                onClick={closeConversationSearch}
                aria-label="بستن جست‌وجوی گفتگوها"
                title="بستن"
              >
                <Icon name="x-close" size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="conversation-search-modal__field" role="search">
              <Icon name="search" size={20} aria-hidden="true" />
              <input
                ref={conversationSearchInputRef}
                type="search"
                dir="rtl"
                value={conversationSearchTerm}
                onChange={(event) => {
                  setConversationSearchTerm(event.target.value);
                  setConversationSearchActiveIndex(-1);
                }}
                placeholder="جستجوی گفتگوها..."
                aria-label="جستجو در گفتگوها"
                autoComplete="off"
              />
              {conversationSearchTerm ? (
                <button
                  type="button"
                  className="conversation-search-modal__clear"
                  onClick={() => {
                    setConversationSearchTerm('');
                    setConversationSearchActiveIndex(-1);
                    conversationSearchInputRef.current?.focus();
                  }}
                  aria-label="پاک کردن جستجو"
                  title="پاک کردن"
                >
                  <Icon name="x-close" size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="conversation-search-modal__results" aria-live="polite">
              <div className="conversation-search-modal__results-heading">
                <span>{searchQuery ? 'نتایج جستجو' : 'گفتگوهای اخیر'}</span>
                <span>{new Intl.NumberFormat('fa-IR').format(searchModalResults.length)}</span>
              </div>

              {searchModalResults.length > 0 ? (
                <div className="conversation-search-modal__result-list">
                  {searchModalResults.map(({ conversation }, listIndex) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`conversation-search-modal__result${conversationSearchActiveIndex === listIndex ? ' is-active' : ''}`}
                      onClick={() => handleSearchResultClick(conversation.id)}
                      tabIndex={0}
                    >
                      <span className="conversation-search-modal__result-icon" aria-hidden="true">
                        <Icon name="chat-bubble" size={20} />
                      </span>
                      <span className="conversation-search-modal__result-copy">
                        <strong>{conversation.title || DEFAULT_TITLE}</strong>
                        <small>{getConversationPreview(conversation) || 'بدون پیام'}</small>
                      </span>
                      <time dateTime={conversation.updatedAt}>{formatConversationDate(conversation.updatedAt)}</time>
                    </button>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="conversation-search-modal__empty">
                  <span className="conversation-search-modal__empty-icon" aria-hidden="true">
                    <Icon name="search" size={22} />
                  </span>
                  <strong>گفتگویی پیدا نشد</strong>
                  <span>عبارت دیگری را جستجو کنید.</span>
                </div>
              ) : (
                <div className="conversation-search-modal__empty">
                  <span className="conversation-search-modal__empty-icon" aria-hidden="true">
                    <Icon name="chat-bubble" size={22} />
                  </span>
                  <strong>هنوز گفتگویی نداری</strong>
                  <span>اولین گفتگو رو شروع کن!</span>
                </div>
              )}
            </div>
          </section>
        </div>
        );
      })() : null}

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

      <div className={`chat-card ${isEmptyConversation ? 'chat-card--empty' : ''}`}>
        {/* Warning banner for users logged in without a JWT token (pre-fix session) */}
        {!hasAuthToken && (
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
            <Icon name="info-circle" size="1.1em" aria-hidden="true" />
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
        <header className="top-bar danoa-top-bar" role="banner">
          <h1 className="visually-hidden">گفتگو با دستیار هوش مصنوعی دانوآ</h1>
          
          <div className="danoa-top-bar__title-wrap">
            {!sidebarOpen ? (
              <button
                ref={chatSidebarToggleRef}
                className="header-action-btn chat-sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
                type="button"
                aria-label="باز کردن پنل گفتگوها"
                title="باز کردن پنل گفتگوها"
              >
                <Icon name="sidebar" size={19} aria-hidden="true" />
              </button>
            ) : null}

            <div className="danoa-top-bar__title">
              <span className="danoa-top-bar__title-text">{activeConversation?.title || DEFAULT_TITLE}</span>
            </div>
          </div>

          <div className="danoa-top-bar__actions">
            {activeConversation && visibleMessages.length > 0 ? (
              <button
                className="header-action-btn danoa-top-action-btn"
                type="button"
                onClick={handleDownloadActiveConversation}
                aria-label="دانلود گفتگو"
                title="دانلود گفتگو"
              >
                <Icon name="download" size={17} aria-hidden="true" />
              </button>
            ) : null}

            <div className="danoa-noa-pill" role="status" aria-label="اعتبار نوآ">
              <button
                type="button"
                className="danoa-noa-pill__add"
                onClick={handleOpenNoaWallet}
                aria-label="افزایش اعتبار نوآ"
                title="افزایش اعتبار نوآ"
              >
                <Icon name="plus" size={13} aria-hidden="true" />
              </button>
              <span className="danoa-noa-pill__label" onClick={handleOpenNoaWallet} style={{ cursor: 'pointer' }}>
                {noaWallet.wallet
                  ? `${formatDecimalFa(noaWallet.wallet.availableBalance)} نوآ`
                  : '— نوآ'}
              </span>
              <span className="danoa-noa-pill__icon" aria-hidden="true" onClick={handleOpenNoaWallet} style={{ cursor: 'pointer' }}>
                <Icon name="sparkles" size={15} />
              </span>
            </div>

            <button
              type="button"
              className="danoa-avatar-badge"
              onClick={handleOpenSettings}
              aria-label="تنظیمات حساب کاربری"
              title="تنظیمات حساب کاربری"
            >
              <span>{String(profile?.name || 'ع').trim().charAt(0)}</span>
            </button>
          </div>
        </header>
        ) : null}

        {currentView === 'chat' ? (
        <aside
          id="chat-history-sidebar"
          className={`sidebar conversation-home chat-history-sidebar ${sidebarOpen ? 'open is-expanded' : 'is-collapsed'}`}
          aria-label="تاریخچه و ناوبری دانوآ"
          aria-expanded={sidebarOpen}
          ref={(node) => {
            if (node) {
              node.inert = !isDesktopChatLayout() && !sidebarOpen;
            }
          }}
        >
          <header className="conversation-home-header">
            <div className="conversation-home-brand">
              <span className="conversation-home-brand__mark" aria-hidden="true">
                <img src={PUBLIC_ASSETS.brandMark} alt="" />
              </span>
              <div className="conversation-home-brand__text">
                <strong>دانوآ</strong>
                <small>همراه هوشمند تو</small>
              </div>
            </div>
            <div className="conversation-home-header-actions">
              <button
                ref={conversationSearchToggleRef}
                type="button"
                className={`conversation-home-search-toggle ${conversationSearchOpen ? 'is-active' : ''}`}
                onClick={() => {
                  setConversationSearchTerm('');
                  setConversationSearchActiveIndex(-1);
                  setConversationSearchOpen(true);
                }}
                aria-label="جستجوی گفتگوها"
                title="جستجوی گفتگوها"
              >
                <Icon name="search" size={20} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="conversation-sidebar-toggle-btn"
                onClick={handleToggleSidebar}
                aria-label={sidebarOpen ? 'بستن منوی کناری' : 'باز کردن منوی کناری'}
                title={sidebarOpen ? 'بستن منوی کناری' : 'باز کردن منوی کناری'}
                aria-expanded={sidebarOpen}
              >
                <Icon name={sidebarOpen ? 'chevron-right' : 'chevron-left'} size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="conversation-home-primary-actions">
            <button
              type="button"
              className="conversation-new-chat-btn"
              onClick={() => void handleCreateConversation()}
              aria-label="گفتگوی جدید"
              title={!sidebarOpen ? 'گفتگوی جدید' : undefined}
            >
              <Icon name="new-chat" size={20} aria-hidden="true" />
              <span className="conversation-new-chat-btn__label">گفتگوی جدید</span>
            </button>
          </div>

          {conversationSearchTerm ? (
            <div className="conversation-history-heading">
              <h2>نتایج جستجو</h2>
              <span>{new Intl.NumberFormat('fa-IR').format(visibleConversations.length)}</span>
            </div>
          ) : null}

          <div className="conversation-list conversation-home-list">
            {!hasHydratedRemoteConversations && profile?.id ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="conversation-row conversation-card conversation-skeleton" aria-hidden="true">
                  <div className="conversation-card-icon skeleton-shimmer" />
                  <div className="conversation-main">
                    <div className="skeleton-line skeleton-line--title" />
                    <div className="skeleton-line skeleton-line--text" />
                  </div>
                  <div className="conversation-card-meta">
                    <div className="skeleton-line skeleton-line--short" />
                  </div>
                </div>
              ))
            ) : null}

            {sidebarPinnedConversations.length > 0 ? (
              <section className="conversation-sidebar-section" aria-labelledby="pinned-conversations-title">
                <div className="conversation-sidebar-section__heading">
                  <h2 id="pinned-conversations-title">سنجاق‌شده</h2>
                  <Icon name="pin" size={16} aria-hidden="true" />
                </div>
                <div className="conversation-group-card">
                  {sidebarPinnedConversations.map(renderSidebarConversation)}
                </div>
              </section>
            ) : null}

            {sidebarToday.length > 0 ? (
              <section className="conversation-sidebar-section" aria-labelledby="today-conversations-title">
                <div className="conversation-sidebar-section__heading">
                  <h2 id="today-conversations-title">امروز</h2>
                </div>
                <div className="conversation-group-card">
                  {sidebarToday.map(renderSidebarConversation)}
                </div>
              </section>
            ) : null}

            {sidebarOlder.length > 0 ? (
              <section className="conversation-sidebar-section" aria-labelledby="older-conversations-title">
                <div className="conversation-sidebar-section__heading">
                  <h2 id="older-conversations-title">هفته گذشته</h2>
                </div>
                <div className="conversation-group-card">
                  {sidebarOlder.map(renderSidebarConversation)}
                </div>
              </section>
            ) : null}

            {visibleConversations.length === 0 ? (
              <div className="conversation-search-empty" role="status">
                {orderedConversations.length === 0 ? (
                  <EmptyState
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6.5 17.5 4 20V7.7C4 5.7 5.7 4 7.7 4h8.6C18.3 4 20 5.7 20 7.7v6.1c0 2-1.7 3.7-3.7 3.7H6.5Z" />
                        <path d="M8 9h8M8 12.3h5.6" />
                      </svg>
                    }
                    title="هنوز گفتگویی نداری"
                    description="اولین گفتگو رو شروع کن!"
                    action={
                      <Button type="button" onClick={handleCreateConversation}>
                        شروع گفتگوی جدید
                      </Button>
                    }
                  />
                ) : (
                  <span>گفتگویی با این عبارت پیدا نشد.</span>
                )}
              </div>
            ) : null}
          </div>

          <nav className="conversation-bottom-nav conversation-sidebar-nav" aria-label="بخش‌های دانوآ">
            <button
              type="button"
              className="conversation-nav-item"
              onClick={openStudioFromChat}
              title={!sidebarOpen ? 'استودیو' : undefined}
              aria-label="استودیو"
            >
              <Icon name="grid" size={21} aria-hidden="true" />
              <span>
                <strong>استودیو</strong>
                <small>ساخت تصویر و ویدیو</small>
              </span>
              <Icon name="chevron-left" size={18} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="conversation-nav-item"
              onClick={handleOpenNoaWallet}
              title={!sidebarOpen ? 'کیف پول نوآ' : undefined}
              aria-label="کیف پول نوآ"
            >
              <Icon name="credit-card" size={21} aria-hidden="true" />
              <span>
                <strong>کیف پول نوآ</strong>
                <small>{noaWallet.wallet ? `${formatDecimalFa(noaWallet.wallet.availableBalance)} نوآ موجودی` : 'مدیریت اعتبار'}</small>
              </span>
              <Icon name="chevron-left" size={18} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="conversation-nav-item conversation-nav-profile"
              onClick={handleOpenSettings}
              title={!sidebarOpen ? (profile?.name || 'تنظیمات حساب کاربری') : undefined}
              aria-label="تنظیمات حساب کاربری"
            >
              <span className="conversation-nav-profile__avatar" aria-hidden="true">
                {String(profile?.name || 'د').trim().charAt(0)}
              </span>
              <span>
                <strong>{profile?.name || 'پروفایل من'}</strong>
                <small>تنظیمات حساب کاربری</small>
              </span>
              <Icon name="chevron-left" size={18} aria-hidden="true" />
            </button>
          </nav>
        </aside>
        ) : null}
        {conversationMenu && conversationMenuTarget ? (
          <div
            id="conversation-context-menu"
            ref={conversationMenuRef}
            className="conversation-context-menu"
            role="menu"
            aria-label={`مدیریت گفتگو: ${conversationMenuTarget.title || DEFAULT_TITLE}`}
            style={{ top: conversationMenu.top, left: conversationMenu.left }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleConversationMenuKeyDown}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setConversationMenu(null);
              }
            }}
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={conversationMenuTarget.pinned}
              className={conversationMenuTarget.pinned ? 'is-active' : ''}
              onClick={() => {
                const targetId = conversationMenuTarget.id;
                setConversationMenu(null);
                updateConversation(targetId, (item) => ({
                  ...item,
                  pinned: !item.pinned,
                  updatedAt: new Date().toISOString()
                }));
              }}
            >
              <span className="conversation-context-menu__icon" aria-hidden="true">
                <Icon name="pin" size={18} />
              </span>
              <span>{conversationMenuTarget.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن گفتگو'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = conversationMenuTarget;
                setConversationMenu(null);
                setEditingId(target.id);
                setEditingTitle(target.title || DEFAULT_TITLE);
              }}
            >
              <span className="conversation-context-menu__icon" aria-hidden="true">
                <Icon name="edit" size={18} />
              </span>
              <span>تغییر نام گفتگو</span>
            </button>
            <span className="conversation-context-menu__separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                const targetId = conversationMenuTarget.id;
                setConversationMenu(null);
                void handleDeleteConversation(targetId);
              }}
            >
              <span className="conversation-context-menu__icon" aria-hidden="true">
                <Icon name="delete" size={18} />
              </span>
              <span>حذف گفتگو</span>
            </button>
          </div>
        ) : null}
        {currentView === 'studio' ? <StudioPage onBackToHome={() => navigateToView('chat')} onOpenImage={openImageStudioFromStudio} onOpenVideo={openVideoStudio} /> : null}
        {currentView === 'images' ? <ImageStudio onBack={currentPathname === '/studio/image' ? returnToStudio : returnToChatFromStudio} backLabel={currentPathname === '/studio/image' ? 'بازگشت به استودیو' : 'بازگشت به چت'} /> : null}
        {currentView === 'video' ? <VideoGenerationPage onBack={returnToStudio} /> : null}
        {false ? (
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
                  <span className="image-gen-wand" aria-hidden="true">
                    <Icon name="sparkle" size={32} />
                  </span>
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
                <Icon name="sparkle" size="1.1em" aria-hidden="true" />
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
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
              <div className="profile-page-header-title">
                <span>حساب کاربری</span>
                <h1>پروفایل من</h1>
              </div>
            </header>

            <section className="profile-page-grid">
              <div className="profile-page-card profile-page-card-main">
                <ProfileForm
                  profile={profile}
                  profileFormName={profileFormName}
                  profileFormAge={profileFormAge}
                  profileFormErrors={profileFormErrors}
                  onNameChange={(event) => setProfileFormName(event.target.value)}
                  onAgeChange={(event) => setProfileFormAge(filterLocalizedDigits(event.target.value))}
                  onSave={() => { handleSaveProfileSettings(); notify.success('تغییرات با موفقیت ذخیره شد'); }}
                  onDeleteAll={handleDeleteAllConversations}
                  onLogout={handleLogout}
                  showAccountActions={false}
                />
              </div>

              <div className="profile-page-card profile-page-card-side">
                <div className="profile-stats">
                  <div className="profile-stats-header">
                    <span>خلاصه وضعیت و فعالیت</span>
                  </div>
                  <div className="profile-stats-grid">
                    <div className="profile-stat-card">
                      <span className="profile-stat-icon profile-stat-icon--chat">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M6.5 17.5 4 20V7.7C4 5.7 5.7 4 7.7 4h8.6C18.3 4 20 5.7 20 7.7v6.1c0 2-1.7 3.7-3.7 3.7H6.5Z" />
                          <path d="M8 9h8M8 12.3h5.6" />
                        </svg>
                      </span>
                      <strong>{new Intl.NumberFormat('fa-IR').format(conversations.length)}</strong>
                      <span>گفتگوهای ذخیره‌شده</span>
                    </div>

                    <div className="profile-stat-card">
                      <span className="profile-stat-icon profile-stat-icon--plan">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m12 4 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5-3.6-3.5 5-.7L12 4Z" />
                        </svg>
                      </span>
                      <strong>{noaWallet.loading && !noaWallet.wallet ? '…' : formatDecimalFa(noaWallet.wallet?.availableBalance)}</strong>
                      <span>موجودی نوآ (توکن)</span>
                    </div>

                    <div className="profile-stat-card">
                      <span className="profile-stat-icon profile-stat-icon--messages">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </span>
                      <strong>{new Intl.NumberFormat('fa-IR').format(conversations.reduce((sum, c) => sum + (c.messages?.length || 0), 0))}</strong>
                      <span>کل پیام‌ها</span>
                    </div>

                    <div className="profile-stat-card">
                      <span className="profile-stat-icon profile-stat-icon--age">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="8" r="3.2" />
                          <path d="M6 18.8c.4-2.8 2.2-4.3 6-4.3s5.6 1.5 6 4.3" />
                        </svg>
                      </span>
                      <strong>{profile?.age ? new Intl.NumberFormat('fa-IR').format(profile.age) : 'ثبت‌نشده'}</strong>
                      <span>سن ثبت‌شده</span>
                    </div>
                  </div>
                </div>

                <div className="profile-quick-actions">
                  <div className="profile-quick-actions-header">
                    <span>دسترسی سریع</span>
                  </div>
                  <button type="button" className="profile-quick-action-btn" onClick={handleOpenNoaWallet}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="20" height="20">
                      <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3z" />
                    </svg>
                    <span>مدیریت و افزایش موجودی نوآ</span>
                  </button>
                  <button type="button" className="profile-quick-action-btn" onClick={() => navigateToView('studio')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="20" height="20">
                      <path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" />
                    </svg>
                    <span>استودیوی ابزارهای هوش مصنوعی</span>
                  </button>
                </div>

                <div className="profile-danger-zone">
                  <div className="profile-danger-zone-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>مدیریت حساب و حریم خصوصی</span>
                  </div>
                  <div className="profile-danger-zone-actions">
                    <button type="button" className="profile-danger-btn" onClick={handleDeleteAllConversations}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="18" height="18">
                        <path d="M5 6.5h14M8.5 6.5V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.5M9.5 10v6a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-6" />
                      </svg>
                      <span>پاک کردن تاریخچه گفتگوها</span>
                    </button>
                    {profile?.id ? (
                      <button type="button" className="profile-danger-btn" onClick={handleLogout}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="18" height="18">
                          <path d="M10.5 7.2 15.3 12l-4.8 4.8" /><path d="M4 12h11" /><path d="M14 5h3.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19H14" />
                        </svg>
                        <span>خروج از حساب کاربری</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </main>
        ) : null}
        {currentView === 'noa' ? (
          <main className="noa-page">
            <header className="noa-page__header">
              <button
                className="generate-page-back"
                type="button"
                onClick={handleBackToHome}
                aria-label="بازگشت به گفتگوها"
                title="بازگشت"
              >
                <Icon name="chevron-left" size={24} aria-hidden="true" />
              </button>
              <div>
                <span>مدیریت اعتبار</span>
                <h1>کیف پول نوآ</h1>
              </div>
              <Button
                className="noa-page__refresh"
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void refreshNoaWorkspace()}
                disabled={noaWallet.loading}
                startIcon={<Icon name="retry" size={18} aria-hidden="true" />}
              >
                {noaWallet.loading ? 'در حال بروزرسانی' : 'بروزرسانی'}
              </Button>
            </header>
            <NoaWalletPanel
              wallet={noaWallet.wallet}
              walletLoading={noaWallet.loading}
              walletError={noaWallet.error}
              onRefreshWallet={noaWallet.refresh}
              refreshVersion={noaRefreshVersion}
            />
          </main>
        ) : null}
        {currentView === 'chat' && sidebarOpen ? (
          <button
            className="sidebar-hitbox"
            type="button"
            aria-label="بستن تاریخچه گفتگوها"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {showProfileModal ? (
          <Dialog open={showProfileModal} title="تنظیمات پروفایل" onClose={() => setShowProfileModal(false)} showFooter={false}>
            <div className="profile-modal">
              <ProfileForm
                profile={profile}
                profileFormName={profileFormName}
                profileFormAge={profileFormAge}
                profileFormErrors={profileFormErrors}
                onNameChange={(event) => setProfileFormName(event.target.value)}
                onAgeChange={(event) => setProfileFormAge(filterLocalizedDigits(event.target.value))}
                onSave={() => { handleSaveProfileSettings(); notify.success('تغییرات ذخیره شد'); }}
                onDeleteAll={handleDeleteAllConversations}
                onLogout={handleLogout}
              />

              <div className="modal-buttons">
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

       {showImageGenModal ? (
         <Dialog open={showImageGenModal} title="ساخت تصویر" onClose={handleCloseImageGenerator} showFooter={false}>
           <div className="image-gen-modal">
             <div className="image-gen-hero" aria-hidden="true">
               <span className="image-gen-glow" />
               <span className="image-gen-orb">
                 <span className="image-gen-wand" aria-hidden="true">
                    <Icon name="sparkle" size={32} />
                  </span>
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
               <Icon name="sparkle" size="1.1em" aria-hidden="true" />
             </Button>
           </div>
         </Dialog>
       ) : null}

        {currentView === 'chat' ? (
        <main id="chat-messages" className="messages-area" ref={messagesContainerRef} aria-live="polite" aria-busy={isSending}>
          {visibleMessages.length ? (
            visibleMessages.map((message, index) => (
              <div
                key={`${message.timestamp}-${index}`}
                className={`message-row ${message.role} ${message.streamStatus ? `stream-${message.streamStatus}` : ''} ${Array.isArray(message.images) && message.images.length > 0 ? 'has-images' : ''}`}
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
                  <div className={`bubble markdown-body ${message.streamStatus === 'streaming' ? 'streaming-bubble' : ''}`}>
                    {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : null}
                    {message.streamStatus === 'streaming' ? <span className="stream-cursor" aria-label="در حال نوشتن" /> : null}
                    {message.streamStatus === 'failed' ? (
                      <div className="stream-state stream-state-error" role="alert">
                        <span>{message.streamError || 'پاسخ کامل نشد. دوباره تلاش کنیم؟'}</span>
                        <button
                          type="button"
                          className="stream-retry-btn"
                          onClick={() => void handleRetryStreamMessage(message)}
                          disabled={isSending}
                          aria-label="تلاش مجدد برای دریافت پاسخ"
                          title="تلاش مجدد"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 11a8 8 0 1 0-2.35 5.65M20 5v6h-6" />
                          </svg>
                        </button>
                      </div>
                    ) : null}
                    {message.streamStatus === 'cancelled' ? (
                      <div className="stream-state stream-state-cancelled">پاسخ با درخواست شما متوقف شد.</div>
                    ) : null}
                    {message.imageStudioRedirect ? (
                      <button
                        type="button"
                        className="image-studio-redirect-btn"
                        onClick={openStudioFromChat}
                      >
                        رفتن به استودیوی تصویر
                      </button>
                    ) : null}
                    {message.billingError?.kind === 'insufficient_balance' ? (
                      <InsufficientBalanceNotice
                        billingError={message.billingError}
                        onOpenWallet={handleOpenNoaWallet}
                        onRetry={message.billingError.retryable && message.billingError.retryMessage
                          ? () => void handleSendMessage(message.billingError?.retryMessage)
                          : undefined}
                      />
                    ) : null}
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
          ) : conversationLoadingId ? (
            <div className="empty-state chat-empty-state" role="status" aria-label="در حال بارگذاری گفتگو">
              <div className="conversation-loading-spinner" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#630ed4" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              </div>
              <strong>در حال بارگذاری گفتگو...</strong>
            </div>
          ) : (
            <div className="danoa-empty-hero">
              <div className="danoa-hero-sparkles" aria-hidden="true">
                <span className="danoa-sparkle danoa-sparkle-1">✦</span>
                <span className="danoa-sparkle danoa-sparkle-2">✦</span>
                <span className="danoa-sparkle danoa-sparkle-3">✦</span>
                <span className="danoa-sparkle danoa-sparkle-4">✦</span>
              </div>

              <div className="danoa-hero-heading-block">
                <h1 className="danoa-hero-title">امروز چه کاری می‌تونم برات انجام بدم؟</h1>
                <p className="danoa-hero-subtitle">دانوآ، دستیار هوشمند شما برای یادگیری، خلق محتوا و تصمیم‌گیری بهتر.</p>
              </div>

              <div className="danoa-shortcuts-row" role="region" aria-label="میانبرهای اصلی دانوآ">
                <button
                  type="button"
                  className="danoa-shortcut-card"
                  onClick={openImageStudioFromStudio}
                >
                  <div className="danoa-shortcut-icon danoa-shortcut-icon--image">
                    <Icon name="studio-image" size={20} />
                  </div>
                  <div className="danoa-shortcut-text">
                    <strong className="danoa-shortcut-title">ساخت تصویر</strong>
                    <span className="danoa-shortcut-desc">خلق تصاویر از متن و ایده‌های شما</span>
                  </div>
                  <div className="danoa-shortcut-arrow">
                    <Icon name="chevron-left" size={15} />
                  </div>
                </button>

                <button
                  type="button"
                  className="danoa-shortcut-card"
                  onClick={openVideoStudio}
                >
                  <div className="danoa-shortcut-icon danoa-shortcut-icon--video">
                    <Icon name="studio-video" size={20} />
                  </div>
                  <div className="danoa-shortcut-text">
                    <strong className="danoa-shortcut-title">ساخت ویدیو</strong>
                    <span className="danoa-shortcut-desc">تبدیل ایده‌ها به ویدیوهای جذاب</span>
                  </div>
                  <div className="danoa-shortcut-arrow">
                    <Icon name="chevron-left" size={15} />
                  </div>
                </button>

                <button
                  type="button"
                  className="danoa-shortcut-card"
                  onClick={openStudioFromChat}
                >
                  <div className="danoa-shortcut-icon danoa-shortcut-icon--tools">
                    <Icon name="briefcase" size={20} />
                  </div>
                  <div className="danoa-shortcut-text">
                    <strong className="danoa-shortcut-title">ابزارها</strong>
                    <span className="danoa-shortcut-desc">ابزارهای کاربردی برای کارهای روزمره</span>
                  </div>
                  <div className="danoa-shortcut-arrow">
                    <Icon name="chevron-left" size={15} />
                  </div>
                </button>
              </div>
            </div>
          )}

          {isSending && !visibleMessages.some((message) => message.streamStatus === 'streaming') ? (
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
        <footer className="input-area danoa-input-area" ref={inputAreaRef}>
          <div className="input-shell danoa-input-shell">
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
                        <Icon name="x-close" size="1em" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className={`composer-row danoa-composer-capsule ${isRecording ? 'recording' : ''} ${shouldShowSendAction ? 'has-action' : 'voice-action'}`}>
              <div className="composer-actions danoa-composer-actions">
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
                    className={`send-btn danoa-send-circle ${isSending ? 'show-stop' : shouldShowSendAction ? 'show-send' : 'show-mic'}`}
                    type="button"
                    onClick={isSending ? handleStopResponse : shouldShowSendAction ? () => void handleSendMessage() : handleStartRecording}
                    aria-label={isSending ? 'توقف پاسخ' : shouldShowSendAction ? 'ارسال پیام' : 'شروع ضبط صدا'}
                    title={isSending ? 'توقف پاسخ' : shouldShowSendAction ? 'ارسال پیام' : 'شروع ضبط صدا'}
                    disabled={!isSending && shouldShowSendAction && !canSendMessage}
                  >
                    <span
                      key={isSending ? 'stop' : shouldShowSendAction ? 'send' : 'mic'}
                      className={`action-icon ${isSending ? 'action-icon-stop' : shouldShowSendAction ? 'action-icon-send' : 'action-icon-mic'}`}
                      aria-hidden="true"
                    >
                      {isSending ? (
                        <svg viewBox="0 0 24 24">
                          <rect x="7" y="7" width="10" height="10" rx="2" />
                        </svg>
                      ) : shouldShowSendAction ? (
                        <svg viewBox="0 0 24 24">
                          <path d="M4.3 11.3 19.5 4.7c.9-.4 1.8.5 1.4 1.4l-6.6 15.2a1 1 0 0 1-1.9-.2l-1-5.7-5.7-1a1 1 0 0 1-.2-1.9Z" />
                        </svg>
                      ) : (
                        <Icon name="mic" size={22} />
                      )}
                    </span>
                  </button>
                )}
              </div>

              <div className={`composer-card danoa-composer-inner ${isRecording ? 'recording' : ''} ${canSendMessage ? 'ready' : ''}`}>
                <div className="composer-main">
                  <div className="message-field">
                    <textarea
                      ref={messageInputRef}
                      dir="auto"
                      rows={1}
                      value={inputValue}
                      disabled={isRecording}
                      onChange={(event) => setInputValue(event.target.value)}
                      onFocus={() => {
                        if (window.matchMedia('(max-width: 767px)').matches) {
                          keyboardDismissedWhileFocusedRef.current = false;
                          setIsMobileKeyboardOpen(true);
                        }
                      }}
                      onPointerDown={() => {
                        if (window.matchMedia('(max-width: 767px)').matches) {
                          keyboardDismissedWhileFocusedRef.current = false;
                          setIsMobileKeyboardOpen(true);
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          if (document.activeElement !== messageInputRef.current) {
                            setIsMobileKeyboardOpen(false);
                          }
                        }, 0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder={isRecording ? 'در حال ضبط صدا...' : 'پیام خود را بنویسید...'}
                      aria-label="نوشتن پیام"
                    />
                  </div>
                </div>
              </div>

              {!isRecording ? (
                <div className="attachment-rail">
                  <div className="attachment-box attachment-tools" ref={attachmentBoxRef}>
                    <button
                      className={`attach-btn danoa-attach-circle ${attachmentMenuOpen ? 'is-open' : ''}`}
                      type="button"
                      aria-label={attachmentMenuOpen ? 'بستن گزینه‌های پیوست' : 'باز کردن گزینه‌های پیوست'}
                      title="افزودن پیوست"
                      aria-haspopup="menu"
                      aria-expanded={attachmentMenuOpen}
                      aria-controls={ATTACHMENT_MENU_ID}
                      onClick={handleAttachmentMenuToggle}
                    >
                      <Icon name="plus" size={20} aria-hidden="true" />
                    </button>
                    {attachmentMenuOpen ? (
                      <div id={ATTACHMENT_MENU_ID} className="attachment-popup" role="menu" aria-label="گزینه‌های پیوست">
                        {ATTACHMENT_MENU_ITEMS.map((item) => (
                          <button key={item.id} type="button" role="menuitem" onClick={handlePickImageClick}>
                            <span className="attachment-popup__icon" aria-hidden="true">
                              <Icon name={item.icon} size="1.2em" />
                            </span>
                            <span className="attachment-popup__copy">
                              <strong>{item.label}</strong>
                              <small>{item.description}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <input ref={imageInputRef} type="file" accept={imageAccept} multiple hidden onChange={handleImageSelect} />
                  </div>
                </div>
              ) : null}
            </div>

            {visibleMessages.length === 0 ? (
              <div className="danoa-suggestions-row" role="region" aria-label="پیشنهادهای گفتگو">
                {SUGGESTION_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="danoa-suggestion-chip"
                    onClick={() => {
                      setInputValue(item.prompt);
                      window.requestAnimationFrame(() => messageInputRef.current?.focus());
                    }}
                  >
                    <Icon name={item.icon} size={13} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <p className="danoa-disclaimer">دانوآ ممکن است اشتباه کند. نتایج را بررسی کنید.</p>
          </div>
        </footer>
        ) : null}
      </div>
    </div>
  );
}

function AppRouteFallback() {
  return (
    <main className="app-route-loading" role="status" aria-live="polite">
      <span className="app-route-loading__visual" aria-hidden="true">
        <span className="app-route-loading__brand">
          <DanoaLoadingMark />
        </span>
        <span className="app-route-loading__spinner" />
      </span>
      <strong>در حال آماده‌سازی دانوآ…</strong>
    </main>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppRouteFallback />}>{children}</Suspense>;
}

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const adminPath = '/admin-secure-9x7k';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('dir', 'rtl');
  }

  if (pathname === '/plans') {
    if (typeof window !== 'undefined') {
      window.location.replace('/');
    }
    return null;
  }

  if (pathname === '/admin/login') {
    return <LazyRoute><AdminLogin onLoginSuccess={() => { window.location.href = adminPath; }} /></LazyRoute>;
  }

  if (pathname === adminPath) {
    return <LazyRoute><AdminPanel /></LazyRoute>;
  }

if (pathname === '/design-system-preview') {
    return <LazyRoute><DesignSystemPreview /></LazyRoute>;
  }

  if (pathname === '/') {
    return <LazyRoute><ChatApp /></LazyRoute>;
  }

  if (pathname === '/landing') {
    return <LazyRoute><LandingPage /></LazyRoute>;
  }


  if (
    pathname !== '/' && pathname !== '/chat' && !/^\/c\/[^/]+$/.test(pathname) && pathname !== '/studio' && pathname !== '/studio/image' && pathname !== '/studio/video' && pathname !== '/images' &&
    pathname !== '/generate' &&
    pathname !== '/photos' &&
    pathname !== '/profile' &&
    pathname !== '/settings' &&
    pathname !== '/noa'
  ) {
    return <LazyRoute><NotFound /></LazyRoute>;
  }

  return (
    <LazyRoute>
      <ChatApp />
    </LazyRoute>
  );
}

export default App;
