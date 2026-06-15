import { ChangeEvent, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Conversation, UserProfile } from './types';
import AdminLogin from './AdminLogin';
import AdminPanel from './AdminPanel';
import defaultBotAvatar from './image.png';
import { generateImageWithPolling } from './services/imageGeneration';
import { Button, Dialog, FieldGroup, TextField, ToastProvider, useToast } from './design-system/components';
import DesignSystemPreview from './design-system/preview/DesignSystemPreview';

const PROFILE_KEY = 'chat_profile';
const PROFILES_KEY = 'chat_profiles';
const CONVERSATIONS_KEY = 'chat_conversations';
const ACTIVE_CONVERSATION_KEY = 'chat_active_conversation_id';
const THEME_KEY = 'danoa_theme';
const DEFAULT_TITLE = 'گفتگوی جدید';
const WAITING_MESSAGES = [
  'در حال یافتن پاسخ',
  'در حال بررسی سوال شما',
  'نزدیک به پایان',
  'لحظاتی دیگر پاسخ می دهم'
];
const CHAT_REQUEST_TIMEOUT_MS = 35000;
const CHAT_MAX_RETRIES = 1;
const BOT_AVATAR_FALLBACK_URL = '/image.png';

type AppProfile = UserProfile & { id?: number | string };
type RecordingAction = 'idle' | 'confirm' | 'cancel';
type LandingStep = 'landing' | 'login' | 'signup' | 'chat';
type PersonalityProfile = {
  interests: string[];
  preferredStyle: 'formal' | 'casual' | 'playful';
  emotionState: 'happy' | 'sad' | 'neutral';
  messageCount: number;
  lastTopics: string[];
};
type AuthMode = 'login' | 'signup';
type ApiErrorData = { error?: string; message?: string; details?: string; redirectTo?: AuthMode | null };
type ApiError = Error & { redirectTo?: AuthMode | null };
type AttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'error';
type ImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  status: AttachmentStatus;
  imageId?: string;
  error?: string;
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
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId?: string;
}) => {
  for (let attempt = 0; attempt <= CHAT_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await safeFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;

const checkPhoneStatus = async (phone: string, mode: AuthMode): Promise<{ exists: boolean; redirectTo: AuthMode | null }> => {
  const response = await safeFetch('/api/auth/phone-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, mode })
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    throw createApiError(payload.error?.trim() || 'بررسی شماره انجام نشد.', payload.redirectTo ?? null);
  }

  const payload = (await response.json()) as { exists?: boolean; redirectTo?: AuthMode | null };
  return { exists: Boolean(payload.exists), redirectTo: payload.redirectTo ?? null };
};

const sendVerificationCode = async (phone: string, mode: AuthMode): Promise<void> => {
  const response = await safeFetch('/api/send-verification-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, mode })
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'ارسال کد تایید انجام نشد.', payload.redirectTo ?? null);
  }
};

const verifyCode = async (phone: string, code: string, mode: AuthMode): Promise<void> => {
  const normalizedCode = String(code || '')
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));

  const response = await safeFetch('/api/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: normalizedCode, mode })
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'تایید کد انجام نشد.', payload.redirectTo ?? null);
  }
};

const registerProfile = async (profile: {
  name: string;
  age: number;
  phone: string;
  id: number | string;
  mode: AuthMode;
}): Promise<{ userId: string; profile: { name: string; age: number; phone: string }; token?: string }> => {
  const response = await safeFetch('/api/register-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    const payload = await parseApiError(response);
    const fallback = await buildRequestErrorMessage(response);
    throw createApiError(payload.error?.trim() || fallback || 'ثبت پروفایل انجام نشد.', payload.redirectTo ?? null);
  }

  return (await response.json()) as { userId: string; profile: { name: string; age: number; phone: string }; token?: string };
};

const loadRemoteConversations = async (profile: UserProfile & { id?: string | number }) => {
  const response = await safeFetch('/api/conversations/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      messages?: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string; images?: Array<{ url: string; alt?: string }> }>;
    }>;
  };
};

const syncRemoteConversations = async (profile: UserProfile & { id?: string | number }, conversations: Conversation[]) => {
  try {
    const response = await safeFetch('/api/conversations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, items: conversations })
    });
    if (!response.ok) {
      console.warn('[conversations] Sync failed:', response.status);
    }
  } catch (error) {
    console.error('[conversations] Sync error:', error);
  }
};

const createConversation = (): Conversation => {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
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

const normalizeConversationFromServer = (item: {
  conversation_id: string;
  title?: string | null;
  pinned?: boolean;
  created_at?: string;
  updated_at?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string; images?: Array<{ url: string; alt?: string }> }>;
}): Conversation => {
  const createdAt = item.created_at || new Date().toISOString();
  const updatedAt = item.updated_at || createdAt;
  const messages = Array.isArray(item.messages)
    ? item.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || updatedAt,
        images: Array.isArray(msg.images)
          ? msg.images
              .filter((image) => image && typeof image.url === 'string' && image.url.trim().length > 0)
              .map((image) => ({
                url: image.url.trim(),
                alt: typeof image.alt === 'string' && image.alt.trim() ? image.alt.trim() : 'تصویر ارسال شده'
              }))
          : undefined
      }))
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
const getDefaultThemeByAge = (age: number): 'energy' | 'calm' => (age < 13 ? 'energy' : 'calm');

function ChatApp() {
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [landingStep, setLandingStep] = useState<LandingStep>('landing');
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [authTransition, setAuthTransition] = useState<'forward' | 'back'>('forward');
  const [hasSavedAccount, setHasSavedAccount] = useState(false);

  const [registrationStep, setRegistrationStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; age?: string; phone?: string; code?: string }>({});

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [hasHydratedRemoteConversations, setHasHydratedRemoteConversations] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1024px)').matches;
  });
  const [showProfileModal, setShowProfileModal] = useState(false);
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
 const [imageGenPrompt, setImageGenPrompt] = useState('');
 const [isGeneratingImage, setIsGeneratingImage] = useState(false);
 const [imageGenStatus, setImageGenStatus] = useState<string>('');
 const [imageGenError, setImageGenError] = useState<string>('');
 const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

 const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Detect stale session: logged in but missing JWT token (from before the token-save fix)
  const hasAuthToken = (() => {
    try { return !!localStorage.getItem('chat_auth_token'); } catch { return false; }
  })();

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recordingActionRef = useRef<RecordingAction>('idle');
  const transcriptRef = useRef('');
  const keepRecordingRef = useRef(false);
  const sendMessageRef = useRef<(value?: string) => Promise<void>>(async () => {});
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const botMessageRef = useRef<HTMLDivElement | null>(null);
  const prevIsSendingRef = useRef(false);
  const messagesContainerRef = useRef<HTMLElement | null>(null);
  const inputAreaRef = useRef<HTMLElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentBoxRef = useRef<HTMLDivElement | null>(null);
  const attachmentUrlsRef = useRef<Set<string>>(new Set());

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const orderedConversations = useMemo(() => sortConversations(conversations), [conversations]);
  const lastAssistantMessageIndex = useMemo(
    () => (activeConversation ? activeConversation.messages.map((item) => item.role).lastIndexOf('assistant') : -1),
    [activeConversation]
  );
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

  useEffect(() => {
    const loadProfile = () => {
      try {
        const rawProfile = localStorage.getItem(PROFILE_KEY);
        if (!rawProfile) return null;

        const parsed = JSON.parse(rawProfile) as Partial<AppProfile>;
        if (!parsed?.name || typeof parsed.name !== 'string' || !Number.isFinite(Number(parsed.age))) {
          return null;
        }

        const hydrated: AppProfile = {
          ...parsed,
          name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'کاربر',
          age: Number(parsed.age),
          personality: normalizePersonality(parsed.personality)
        };
        return hydrated;
      } catch (err) {
        console.error('[profile] Failed to load profile:', err);
        return null;
      }
    };

    try {
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
        setHasSavedAccount(true);
      } else {
        setLandingStep('landing');
      }

      if (rawConversations) {
        const parsedConversations = JSON.parse(rawConversations) as Conversation[];
        if (parsedConversations.length > 0) {
          const sorted = sortConversations(parsedConversations);
          setConversations(sorted);
          const validActiveConversation =
            savedActiveConversationId && sorted.some((item) => item.id === savedActiveConversationId)
              ? savedActiveConversationId
              : sorted[0].id;
          setActiveConversationId(validActiveConversation);
          return;
        }
      }

      const initialConversation = createConversation();
      setConversations([initialConversation]);
      setActiveConversationId(initialConversation.id);
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify([initialConversation]));
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, initialConversation.id);
    } catch {
      const fallbackConversation = createConversation();
      setConversations([fallbackConversation]);
      setActiveConversationId(fallbackConversation.id);
    }
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
    if (!profile || !showProfileModal) {
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
  }, [profile, showProfileModal]);

  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
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
      setBrokenImages(new Set());
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
        activeConversation?.messages[lastAssistantMessageIndex]?.role === 'assistant';

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
  }, [activeConversationId, activeConversation?.messages.length, isSending, lastAssistantMessageIndex, activeConversation]);

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
      if (event.error === 'aborted' && recordingActionRef.current !== 'idle') {
        return;
      }
      keepRecordingRef.current = false;
      recordingActionRef.current = 'cancel';
      setIsRecording(false);
      pushToast('دسترسی به میکروفن برقرار نشد. لطفاً دوباره تلاش کن.', 'danger');
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
      recognitionRef.current = null;
    };
  }, [pushToast]);

  const updateConversation = (conversationId: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((item) => (item.id === conversationId ? updater(item) : item)));
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

  const handleRegisterStepOne = (event: FormEvent) => {
    event.preventDefault();

    const nextErrors: { name?: string; age?: string } = {};
    const numericAge = Number(age);

    if (!name.trim()) {
      nextErrors.name = 'اسم خودت را بنویس تا با هم آشنا شویم.';
    }

    if (!age || Number.isNaN(numericAge) || numericAge < 8 || numericAge > 18) {
      nextErrors.age = 'سن باید بین 8 تا 18 سال باشد.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setRegistrationStep(2);
  };

  const handleRegisterStepTwo = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedPhone = phone.trim();
    const nextErrors: { phone?: string } = {};

    if (!PERSIAN_PHONE_REGEX.test(trimmedPhone)) {
      nextErrors.phone = 'شماره موبایل باید با 09 شروع شود و 11 رقم باشد.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSendingVerification(true);
    setIsCheckingPhone(true);

    try {
      const phoneStatus = await checkPhoneStatus(trimmedPhone, authMode);
      if (phoneStatus.redirectTo) {
        setAuthTransition('forward');
        setAuthMode(phoneStatus.redirectTo);
        setLandingStep(phoneStatus.redirectTo);
        setRegistrationStep(2);
        setErrors({
          phone:
            phoneStatus.redirectTo === 'login'
              ? 'این شماره قبلاً ثبت‌نام شده است. لطفاً وارد شوید.'
              : 'حسابی با این شماره یافت نشد. لطفاً ثبت نام کنید.'
        });
        return;
      }

      await sendVerificationCode(trimmedPhone, authMode);

      setVerificationCode('');
      setErrors({});
      setRegistrationStep(3);
    } catch (error) {
      const redirectTo = error && typeof error === 'object' ? (error as ApiError).redirectTo : null;
      if (redirectTo) {
        setAuthTransition('forward');
        setAuthMode(redirectTo);
        setLandingStep(redirectTo);
        setRegistrationStep(2);
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

    const trimmedPhone = phone.trim();
    const normalizePhone = (value: string) => value.trim().replace(/[-\s]/g, '');
    const normalizedPhone = normalizePhone(trimmedPhone);
    const trimmedCode = verificationCode.trim();
    const nextErrors: { code?: string } = {};

    const normalizedCode = trimmedCode
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));

    if (!/^[0-9]{5,6}$/.test(normalizedCode)) {
      nextErrors.code = 'کد تایید باید 5 یا 6 رقم باشد.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsVerifyingCode(true);

    try {
      await verifyCode(trimmedPhone, normalizedCode, authMode);

      if (authMode === 'login') {
        const loginProfileId = generateUniqueId();
        const registrationResult = await registerProfile({
          name: name.trim() || 'کاربر',
          age: Number(age) || 0,
          phone: trimmedPhone,
          id: loginProfileId,
          mode: 'login'
        });
        const normalizedProfile: AppProfile = {
          name: registrationResult.profile.name,
          age: Number(registrationResult.profile.age),
          phone: registrationResult.profile.phone,
          id: registrationResult.userId || loginProfileId,
          personality: createDefaultPersonality()
        };

        // Save JWT token for authenticated API calls (e.g. image generation)
        if (registrationResult.token) {
          localStorage.setItem('chat_auth_token', registrationResult.token);
        }

        setHasHydratedRemoteConversations(false);
        setProfile(normalizedProfile);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(normalizedProfile));
        const rawProfiles = localStorage.getItem(PROFILES_KEY);
        const parsedProfiles = rawProfiles ? (JSON.parse(rawProfiles) as AppProfile[]) : [];
        const profiles = Array.isArray(parsedProfiles) ? parsedProfiles : [];
        const withoutSamePhone = profiles.filter((item) => {
          const savedPhone = typeof item?.phone === 'string' ? normalizePhone(item.phone) : '';
          return savedPhone !== normalizedPhone;
        });
        localStorage.setItem(PROFILES_KEY, JSON.stringify([...withoutSamePhone, normalizedProfile]));
        setLandingStep('chat');
        return;
      }

      const payload: AppProfile = {
        name: name.trim(),
        age: Number(age),
        phone: trimmedPhone,
        id: generateUniqueId(),
        personality: createDefaultPersonality()
      };

      const registrationResult = await registerProfile({
        name: payload.name,
        age: Number(payload.age),
        phone: payload.phone || trimmedPhone,
        id: payload.id ?? generateUniqueId(),
        mode: 'signup'
      });
      payload.id = registrationResult.userId || payload.id;

      // Save JWT token for authenticated API calls (e.g. image generation)
      if (registrationResult.token) {
        localStorage.setItem('chat_auth_token', registrationResult.token);
      }

      setHasHydratedRemoteConversations(false);
      setProfile(payload);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(payload));
      setLandingStep('chat');
      const rawProfiles = localStorage.getItem(PROFILES_KEY);
      const parsedProfiles = rawProfiles ? (JSON.parse(rawProfiles) as AppProfile[]) : [];
      const profiles = Array.isArray(parsedProfiles) ? parsedProfiles : [];
      const withoutSamePhone = profiles.filter((item) => {
        const savedPhone = typeof item?.phone === 'string' ? normalizePhone(item.phone) : '';
        return savedPhone !== normalizedPhone;
      });
      localStorage.setItem(PROFILES_KEY, JSON.stringify([...withoutSamePhone, payload]));
      setHasSavedAccount(true);
    } catch (error) {
      const redirectTo = error && typeof error === 'object' ? (error as ApiError).redirectTo : null;
      if (redirectTo) {
        setAuthTransition('forward');
        setAuthMode(redirectTo);
        setLandingStep(redirectTo);
        setRegistrationStep(2);
      }
      setErrors({
        code: error instanceof Error && error.message.trim() ? error.message : 'کد نادرست است'
      });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleSendMessage = async (value?: string) => {
    if (!profile || isSending) {
      return;
    }

    const content = (value ?? inputValue).trim();
    const attachmentsAtSend = [...attachments];
    const sentAttachmentIds = new Set(attachmentsAtSend.map((item) => item.id));
    const hasAttachments = attachmentsAtSend.length > 0;
    if (!content && !hasAttachments) {
      return;
    }

    // Detect /imagine command — route to image generation instead of chat
    const imagineMatch = content.match(/^\/imagine\s+(.+)/i);
    if (imagineMatch && !hasAttachments) {
      const imaginePrompt = imagineMatch[1].trim();
      if (imaginePrompt) {
        await handleImagineCommand(imaginePrompt);
        setInputValue('');
        return;
      }
    }

    const effectiveUserText = content || 'لطفاً محتوای عکس را توضیح بده.';
    const nextPersonality = updatePersonalityFromMessage(normalizePersonality(profile.personality), effectiveUserText);
    const nextProfile: AppProfile = {
      ...profile,
      personality: nextPersonality
    };
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));

    const currentConversation = ensureConversation();
    const previewImages = attachmentsAtSend.map((attachment, index) => ({
      url: attachment.previewUrl,
      alt: attachment.file.name || `تصویر ارسال شده ${index + 1}`
    }));
    const userMessage: ChatMessage = {
      role: 'user',
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

      const history = updatedMessages.map((msg) => ({
        role: msg.role,
        content: msg.content
      }));

      const response = await postChatWithRetry({
        message: content,
        imageIds: uploadedImageIds,
        profile: nextProfile,
        personality: nextPersonality,
        history,
        conversationId: currentConversation.id
      });

      if (!response.ok) {
        const message = await buildRequestErrorMessage(response);
        throw new Error(message);
      }

      const data = (await response.json()) as { reply?: string };
      const replyText = data.reply?.trim() || 'الان نتوانستم پاسخ بدهم. لطفاً دوباره امتحان کن.';

      const botMessage: ChatMessage = {
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString()
      };

      updateConversation(currentConversation.id, (item) => ({
        ...item,
        messages: [...item.messages, botMessage],
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
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
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        pushToast(`فرمت ${file.name} مجاز نیست.`, 'danger');
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        pushToast(`حجم ${file.name} بیشتر از ۵ مگابایت است.`, 'danger');
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
      if (merged.length > MAX_ATTACHMENT_COUNT) {
        pushToast('حداکثر ۵ عکس قابل انتخاب است. فقط ۵ مورد اول نگه داشته شد.', 'warning');
      }
      const limited = merged.slice(0, MAX_ATTACHMENT_COUNT);
      const removed = merged.slice(MAX_ATTACHMENT_COUNT);
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
      const response = await safeFetch('/api/uploads/images', { method: 'POST', body: formData });
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
    const textarea = messageInputRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [inputValue]);

  useEffect(() => {
    return () => {
      attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlsRef.current.clear();
    };
  }, []);

  const handleCreateConversation = () => {
    const fresh = createConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveConversationId(fresh.id);
    setSidebarOpen(false);
    setInputValue('');
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
      const fresh = createConversation();
      setConversations([fresh]);
      setActiveConversationId(fresh.id);
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

    const freshConversation = createConversation();
    setConversations([freshConversation]);
    setActiveConversationId(freshConversation.id);
    setSidebarOpen(false);
    setInputValue('');
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify([freshConversation]));
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, freshConversation.id);
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
    setHasSavedAccount(Boolean(localStorage.getItem(PROFILES_KEY)));
  };

  const handleStartRecording = () => {
    if (!recognitionRef.current) {
      pushToast('مرورگر تو از ضبط صدا پشتیبانی نمی کند.', 'warning');
      return;
    }

    try {
      recordingActionRef.current = 'idle';
      transcriptRef.current = '';
      keepRecordingRef.current = true;
      setIsRecording(true);
      recognitionRef.current.start();
    } catch {
      keepRecordingRef.current = false;
      setIsRecording(false);
      pushToast('فعلاً نتوانستم ضبط را شروع کنم. دوباره امتحان کن.', 'danger');
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
 };

 const handleGenerateImageClick = () => {
   setAttachmentMenuOpen(false);
   setImageGenPrompt('');
   setImageGenError('');
   setImageGenStatus('');
   setShowImageGenModal(true);
 };

 /**
  * Handles the /imagine <prompt> command from the chat input.
  * Adds user + bot messages to the conversation and polls for the result.
  */
 const handleImagineCommand = async (prompt: string) => {
   if (!profile || isSending) {
     return;
   }

   // Check for JWT token before starting image generation
   if (!localStorage.getItem('chat_auth_token')) {
     pushToast('توکن احراز هویت موجود نیست. لطفاً یک‌بار خارج و دوباره وارد شوید.', 'danger');
     return;
   }

   const currentConversation = ensureConversation();

   // Add user message showing the command
   const userMessage: ChatMessage = {
     role: 'user',
     content: `🎨 /imagine ${prompt}`,
     timestamp: new Date().toISOString()
   };

   const updatedMessages = [...currentConversation.messages, userMessage];
   const tempBotIndex = updatedMessages.length;
   const tempBotMessage: ChatMessage = {
     role: 'assistant',
     content: '🎨 در حال ساخت عکس... لطفاً صبر کن',
     timestamp: new Date().toISOString()
   };

   updateConversation(currentConversation.id, (item) => ({
     ...item,
     title: item.title === DEFAULT_TITLE ? `🎨 ${prompt.slice(0, 28)}...` : item.title,
     messages: [...updatedMessages, tempBotMessage],
     updatedAt: new Date().toISOString()
   }));

   setIsSending(true);

   try {
     const imageUrl = await generateImageWithPolling(prompt, (statusLabel, attempt) => {
       updateConversation(currentConversation.id, (item) => ({
         ...item,
         messages: item.messages.map((msg, idx) =>
           idx === tempBotIndex
             ? { ...msg, content: `🎨 ${statusLabel} (مرحله ${attempt})` }
             : msg
         ),
         updatedAt: new Date().toISOString()
       }));
     });

     const botMessage: ChatMessage = {
       role: 'assistant',
       content: 'عکس آماده شد! 🎉',
       timestamp: new Date().toISOString(),
       images: [{ url: imageUrl, alt: prompt }]
     };

     updateConversation(currentConversation.id, (item) => ({
       ...item,
       messages: item.messages.map((msg, idx) =>
         idx === tempBotIndex ? botMessage : msg
       ),
       updatedAt: new Date().toISOString()
     }));

     pushToast('عکس با موفقیت ساخته شد', 'success');
   } catch (error) {
     const errorMessage: ChatMessage = {
       role: 'assistant',
       content: error instanceof Error ? error.message : 'مشکلی در ساخت عکس پیش آمد.',
       timestamp: new Date().toISOString()
     };

     updateConversation(currentConversation.id, (item) => ({
       ...item,
       messages: item.messages.map((msg, idx) =>
         idx === tempBotIndex ? errorMessage : msg
       ),
       updatedAt: new Date().toISOString()
     }));

     pushToast('ساخت عکس ناموفق بود', 'danger');
   } finally {
     setIsSending(false);
   }
 };

 const handleGenerateImageSubmit = async () => {
   const prompt = imageGenPrompt.trim();
   if (!prompt) {
     pushToast('لطفاً توضیح عکس را بنویس', 'danger');
     return;
   }

   // Check for JWT token before starting image generation
   if (!localStorage.getItem('chat_auth_token')) {
     pushToast('توکن احراز هویت موجود نیست. لطفاً یک‌بار خارج و دوباره وارد شوید.', 'danger');
     setImageGenError('برای ساخت عکس نیاز به ورود مجدد دارید.');
     return;
   }

   setIsGeneratingImage(true);
   setImageGenStatus('در حال ارسال درخواست...');
   setImageGenError('');
   setShowImageGenModal(false);

   const currentConversation = ensureConversation();
   const userMessage: ChatMessage = {
     role: 'user',
     content: `🎨 درخواست ساخت عکس: ${prompt}`,
     timestamp: new Date().toISOString()
   };

   updateConversation(currentConversation.id, (item) => ({
     ...item,
     messages: [...item.messages, userMessage],
     updatedAt: new Date().toISOString()
   }));

   // Add a temporary "generating" bot message to show progress
   const tempBotMessage: ChatMessage = {
     role: 'assistant',
     content: '🎨 در حال ساخت عکس... لطفاً صبر کن',
     timestamp: new Date().toISOString()
   };

   updateConversation(currentConversation.id, (item) => ({
     ...item,
     messages: [...item.messages, tempBotMessage],
     updatedAt: new Date().toISOString()
   }));

   try {
     const imageUrl = await generateImageWithPolling(prompt, (statusLabel, attempt) => {
       setImageGenStatus(statusLabel);
       // Update the temp bot message with progress
       updateConversation(currentConversation.id, (item) => ({
         ...item,
         messages: item.messages.map((msg, idx) =>
           idx === item.messages.length - 1
             ? { ...msg, content: `🎨 ${statusLabel} (مرحله ${attempt})` }
             : msg
         ),
         updatedAt: new Date().toISOString()
       }));
     });

     // Replace the temp message with the final result
     const botMessage: ChatMessage = {
       role: 'assistant',
       content: 'عکس آماده شد! 🎉',
       timestamp: new Date().toISOString(),
       images: [{ url: imageUrl, alt: prompt }]
     };

     updateConversation(currentConversation.id, (item) => ({
       ...item,
       messages: item.messages.map((msg, idx) =>
         idx === item.messages.length - 1 ? botMessage : msg
       ),
       updatedAt: new Date().toISOString()
     }));

     pushToast('عکس با موفقیت ساخته شد', 'success');
   } catch (error) {
     const errorMessage: ChatMessage = {
       role: 'assistant',
       content: error instanceof Error ? error.message : 'مشکلی در ساخت عکس پیش آمد.',
       timestamp: new Date().toISOString()
     };

     updateConversation(currentConversation.id, (item) => ({
       ...item,
       messages: item.messages.map((msg, idx) =>
         idx === item.messages.length - 1 ? errorMessage : msg
       ),
       updatedAt: new Date().toISOString()
     }));

     pushToast('ساخت عکس ناموفق بود', 'danger');
   } finally {
     setIsGeneratingImage(false);
     setImageGenStatus('');
     setImageGenError('');
   }
 };

 const handleSaveProfileSettings = () => {
    if (!profile) {
      return;
    }

    const nextErrors: { name?: string; age?: string } = {};
    const numericAge = Number(profileFormAge);

    if (!profileFormName.trim()) {
      nextErrors.name = 'نام نمی‌تواند خالی باشد.';
    }

    if (!profileFormAge || Number.isNaN(numericAge) || numericAge < 8 || numericAge > 18) {
      nextErrors.age = 'سن باید بین 8 تا 18 سال باشد.';
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

  if (!profile) {
    const authCardClass = `register-card auth-card ${authTransition === 'back' ? 'slide-back' : 'slide-forward'}`;
    return (
      <div className="app-shell auth-shell">
        <div className="bg-blob blob-pink" />
        <div className="bg-blob blob-orange" />
        <div className="bg-blob blob-yellow" />
        <div className="bg-blob blob-purple" />

        {landingStep === 'landing' ? (
          <div className={authCardClass}>
            <h1>
              به دانوآ خوش آمدید <span>🌤️</span>
            </h1>
            <p className="subtitle">همراه یادگیری تو، با حال خوب و گفتگوی هوشمند</p>
            <Button
              type="button"
              className="start-btn landing-btn"
              onClick={() => {
                setAuthTransition('forward');
                setAuthMode('login');
                setRegistrationStep(2);
                setLandingStep('login');
                setErrors({});
                setVerificationCode('');
              }}
            >
              حساب کاربری دارم
            </Button>
            <Button
              type="button"
              className="start-btn landing-btn secondary"
              variant="secondary"
              onClick={() => {
                setAuthTransition('forward');
                setAuthMode('signup');
                setRegistrationStep(1);
                setLandingStep('signup');
                setErrors({});
              }}
            >
              حساب کاربری ندارم
            </Button>
            <p className="helper onboarding-help">
              {hasSavedAccount ? 'حساب قبلی روی این مرورگر پیدا شد ✅' : 'اگر اولین بارته، ثبت نام را انتخاب کن.'}
            </p>
          </div>
        ) : authMode === 'signup' && registrationStep === 1 ? (
          <form className={authCardClass} onSubmit={handleRegisterStepOne}>
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => {
                setAuthTransition('back');
                setLandingStep('landing');
                setErrors({});
              }}
            >
              ← بازگشت
            </button>
            <h1>
              سلام رفیق! <span>✨</span>
            </h1>
            <p className="subtitle">دانوآ، همون دوستی که همیشه برات می‌مونه!</p>
            <p className="helper onboarding-help">مرحله 1 از 3: نام و سن را وارد کن ✨</p>

            <TextField
              label="نام"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثلا: علی"
              type="text"
              autoComplete="name"
              errorText={errors.name}
            />

            <TextField
              label="سن"
              value={age}
              onChange={(event) => setAge(event.target.value)}
              placeholder="فقط عدد"
              type="number"
              min={8}
              max={18}
              inputMode="numeric"
              helperText="محدوده سنی مجاز: 8 تا 18 سال"
              errorText={errors.age}
            />

            <Button type="submit" className="start-btn">ادامه</Button>
          </form>
        ) : registrationStep === 2 ? (
          <form className={authCardClass} onSubmit={handleRegisterStepTwo}>
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => {
                if (authMode === 'login') {
                  setAuthTransition('back');
                  setLandingStep('landing');
                } else {
                  setRegistrationStep(1);
                }
                setErrors({});
              }}
            >
              ← بازگشت
            </button>
            <h1>
              تقریبا تمومه! <span>📱</span>
            </h1>
            <p className="subtitle">
              {authMode === 'login' ? 'ورود: شماره موبایل را وارد کن' : 'مرحله 2 از 3: شماره موبایل را وارد کن'}
            </p>
            <p className="helper onboarding-help">
              کد تایید از طریق پیامک ارسال می شود.
            </p>

            <TextField
              label="شماره موبایل"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="09123456789"
              type="tel"
              inputMode="numeric"
              maxLength={11}
              autoComplete="tel"
              helperText="فرمت معتبر: 09XXXXXXXXX"
              errorText={errors.phone}
            />

            <div className="ds-auth-actions">
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  if (authMode === 'login') {
                    setAuthTransition('back');
                    setLandingStep('landing');
                  } else {
                    setRegistrationStep(1);
                  }
                  setErrors({});
                }}
              >
                {authMode === 'login' ? 'صفحه اول' : 'بازگشت'}
              </Button>
              <Button type="submit" className="start-btn" disabled={isSendingVerification || isCheckingPhone}>
                {isCheckingPhone ? 'در حال بررسی شماره...' : isSendingVerification ? 'در حال ارسال...' : 'ادامه'}
              </Button>
            </div>
          </form>
        ) : (
          <form className={authCardClass} onSubmit={handleVerifyCode}>
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => {
                setRegistrationStep(2);
                setVerificationCode('');
                setErrors({});
              }}
            >
              ← بازگشت
            </button>
            <h1>
              کد را وارد کن <span>✅</span>
            </h1>
            <p className="subtitle">{authMode === 'login' ? 'ورود: کد 6 رقمی تأیید' : 'مرحله 3 از 3: کد 6 رقمی تأیید'}</p>
            <p className="helper onboarding-help">کد ارسال شده را در این بخش وارد کنید.</p>

            <TextField
              label="کد تایید"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="123456"
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
                  setRegistrationStep(2);
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
        )}
      </div>
    );
  }

  const canSendMessage = !isRecording && !isSending && (inputValue.trim().length > 0 || attachments.length > 0);

  return (
    <div className={`app-shell chat-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <div className="bg-blob blob-pink" />
      <div className="bg-blob blob-orange" />
      <div className="bg-blob blob-yellow" />
      <div className="bg-blob blob-purple" />

      <div className="chat-card">
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
        <header className="top-bar">
          <div className="top-bar-main">
            <button
              className={`menu-btn ${sidebarOpen ? 'open' : ''}`}
              onClick={() => setSidebarOpen((prev) => !prev)}
              type="button"
              aria-label={sidebarOpen ? 'بستن منو' : 'باز کردن منو'}
              aria-expanded={sidebarOpen}
            >
              <span className="menu-btn-line" />
              <span className="menu-btn-line" />
              <span className="menu-btn-line short" />
            </button>

            <div className="top-title">
              <span className="avatar avatar-orb">
                <span className="avatar-ring" />
                <span className="avatar-core">🧠</span>
              </span>

              <div className="top-copy">
                <div className="top-copy-row">
                  <strong>دانوآ</strong>
                  <span className="top-status-badge">
                    <span className="status-dot" />
                    آنلاین
                  </span>
                </div>
                <div className="top-meta">
                  <span>سلام {profile.name} 👋</span>
                  <span className="top-meta-sep">•</span>
                  <span>همراه گفتگوی امروز</span>
                </div>
              </div>
            </div>
          </div>

          <div className="top-bar-actions">
            <button
              className="header-action-btn"
              type="button"
              onClick={handleCreateConversation}
              aria-label="گفتگوی جدید"
              title="گفتگوی جدید"
            >
              <span className="header-action-icon" aria-hidden="true">✦</span>
              <span className="header-action-text">گفتگوی جدید</span>
            </button>
            <button
              className="header-action-btn header-action-btn-secondary"
              type="button"
              onClick={() => setShowProfileModal(true)}
              aria-label="تنظیمات پروفایل"
              title="تنظیمات پروفایل"
            >
              <span className="header-action-icon" aria-hidden="true">⚙</span>
            </button>
          </div>
        </header>

        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-head">
            <h3>گفتگوها</h3>
            <Button type="button" variant="secondary" size="sm" className="sidebar-btn sidebar-btn-head" onClick={handleCreateConversation}>
              + گفتگوی جدید
            </Button>
          </div>

          <div className="conversation-list">
            {orderedConversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;
              const isEditing = editingId === conversation.id;
              return (
                <div
                  className={`conversation-row ${isActive ? 'active' : ''}`}
                  key={conversation.id}
                  onClick={() => {
                    setActiveConversationId(conversation.id);
                    setSidebarOpen(false);
                  }}
                >
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
                        <small>{conversation.messages.length} پیام</small>
                      </>
                    )}
                  </div>

                  <div className="conversation-actions" onClick={(event) => event.stopPropagation()}>
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
              );
            })}
          </div>

          <div className="sidebar-footer">
            <Button type="button" variant="secondary" className="sidebar-btn" onClick={handleDownloadActiveConversation} title="ذخیره گفتگوی جاری">
              <span aria-hidden="true">📥</span>
              ذخیره گفتگو
            </Button>
            <Button type="button" variant="secondary" className="sidebar-btn" onClick={() => setShowProfileModal(true)}>
              <span aria-hidden="true">⚙️</span>
              تنظیمات پروفایل
            </Button>
            <Button type="button" variant="danger" className="sidebar-btn" onClick={handleDeleteAllConversations}>
              <span aria-hidden="true">🗑️</span>
              حذف همه گفتگوها
            </Button>
            <Button type="button" variant="danger" className="sidebar-btn" onClick={handleLogout}>
              <span aria-hidden="true">🚪</span>
              خروج ار حساب کاربری
            </Button>
          </div>
        </aside>
        {sidebarOpen ? (
          <button
            className="sidebar-hitbox"
            type="button"
            aria-label="بستن منو"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {showProfileModal ? (
          <Dialog open={showProfileModal} title="تنظیمات پروفایل" onClose={() => setShowProfileModal(false)} showFooter={false}>
              <h3>تنظیمات پروفایل</h3>

              <TextField label="نام" type="text" value={profileFormName} onChange={(event) => setProfileFormName(event.target.value)} errorText={profileFormErrors.name} />

              <TextField label="سن" type="number" min={8} max={18} inputMode="numeric" value={profileFormAge} onChange={(event) => setProfileFormAge(event.target.value)} errorText={profileFormErrors.age} />

              <TextField label="شماره موبایل" type="text" value={profile.phone || '-'} readOnly helperText="شماره موبایل فقط هنگام ثبت نام تعیین می شود." />

              <div className="profile-id-box">
                <span>شناسه یکتا:</span>
                <code>{String(profile.id ?? '')}</code>
              </div>

              <div className="profile-section">
                <label>تم سایت</label>
                <div className="ds-inline-actions" style={{ marginTop: '8px' }}>
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

              <div className="parent-panel-soon">پنل والد به زودی فعال می‌شود</div>

              <div className="modal-buttons">
                <Button type="button" className="start-btn" onClick={() => { handleSaveProfileSettings(); pushToast('تغییرات ذخیره شد', 'success'); }}>
                  ذخیره تغییرات
                </Button>
                <Button type="button" variant="danger" onClick={() => setShowProfileModal(false)}>
                  انصراف
                </Button>
              </div>
          </Dialog>
       ) : null}

       {showImageGenModal ? (
         <Dialog open={showImageGenModal} title="ساخت عکس با هوش مصنوعی" onClose={() => setShowImageGenModal(false)} showFooter={false}>
           <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
             <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
               توضیح بده چه عکسی می‌خوای تا برات بسازم
             </p>
             <TextField
               label="توضیح عکس"
               type="text"
               value={imageGenPrompt}
               onChange={(e) => setImageGenPrompt(e.target.value)}
               placeholder="مثلاً: یک گربه قرمز روی میز"
               disabled={isGeneratingImage}
               errorText={imageGenError}
             />
             {imageGenStatus && (
               <div style={{ fontSize: '14px', color: 'var(--accent)', textAlign: 'center' }}>
                 {imageGenStatus}
               </div>
             )}
             <div className="modal-buttons">
               <Button
                 type="button"
                 className="start-btn"
                 onClick={handleGenerateImageSubmit}
                 disabled={isGeneratingImage || !imageGenPrompt.trim()}
               >
                 {isGeneratingImage ? 'در حال ساخت...' : 'بساز'}
               </Button>
               <Button
                 type="button"
                 variant="danger"
                 onClick={() => { setShowImageGenModal(false); setImageGenError(''); setImageGenStatus(''); }}
                 disabled={isGeneratingImage}
               >
                 انصراف
               </Button>
             </div>
           </div>
         </Dialog>
       ) : null}

       <main className="messages-area" ref={messagesContainerRef}>
          {activeConversation?.messages.length ? (
            activeConversation.messages.map((message, index) => (
              <div
                key={`${message.timestamp}-${index}`}
                className={`message-row ${message.role}`}
                ref={(node) => {
                  if (index === activeConversation.messages.length - 1) {
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
                  </div>
                ) : (
                  <div className="bubble">
                    {message.content ? <div>{message.content}</div> : null}
                    {Array.isArray(message.images) && message.images.length > 0 ? (
                      <div className="message-image-grid">
                        {message.images.map((image, imageIndex) => {
                          const imageKey = `${image.url}-${imageIndex}`;
                          if (brokenImages.has(imageKey)) {
                            return (
                              <div key={imageKey} className="image-load-error">
                                ⚠️ خطا در بارگذاری تصویر — لطفاً دوباره تلاش کنید
                              </div>
                            );
                          }
                          return (
                            <img
                              key={imageKey}
                              className="message-image"
                              src={image.url}
                              alt={image.alt || 'تصویر ارسال شده'}
                              loading="lazy"
                              decoding="async"
                              onError={() => {
                                setBrokenImages((prev) => {
                                  const next = new Set(prev);
                                  next.add(imageKey);
                                  return next;
                                });
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">هر چی دوست داری بنویس تا با هم شروع کنیم 🌟</div>
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

        <footer className="input-area" ref={inputAreaRef}>
          <div className="input-shell">
            <FieldGroup direction="row" className="chips-row">
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleSendMessage('📚 کمک درسی')}>
                <span aria-hidden="true">📚</span>
                کمک درسی
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleSendMessage('💬 احساسات')}>
                <span aria-hidden="true">💬</span>
                احساسات
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleSendMessage('✨ داستان')}>
                <span aria-hidden="true">✨</span>
                داستان
              </Button>
            </FieldGroup>

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

            <div className={`composer-card ${isRecording ? 'recording' : ''} ${canSendMessage ? 'ready' : ''}`}>
              <div className="composer-main">
                {!isRecording ? (
                  <div className="attachment-rail">
                    <div className="attachment-box" ref={attachmentBoxRef}>
                      <button
                        className="attach-btn"
                        type="button"
                        aria-label="پیوست"
                        onClick={() => setAttachmentMenuOpen((prev) => !prev)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M16.2 7.8a4.3 4.3 0 0 0-6.1 0l-5 5a4.3 4.3 0 1 0 6 6.1l5.4-5.4a2.8 2.8 0 1 0-4-4l-5 5a1.3 1.3 0 1 0 1.8 1.8l4.6-4.7a.9.9 0 0 1 1.3 1.3l-4.6 4.7a3.1 3.1 0 0 1-4.5-4.4l5-5a4.7 4.7 0 1 1 6.7 6.6l-5.3 5.4a6.2 6.2 0 1 1-8.8-8.8l5-5a.9.9 0 0 1 1.3 1.3l-5 5a4.4 4.4 0 1 0 6.1 6.1l5.3-5.4a2.9 2.9 0 0 0 0-4.1Z" />
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
                      <input ref={imageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple hidden onChange={handleImageSelect} />
                    </div>
                  </div>
                ) : null}

                <div className="message-field">
                  <textarea
                    ref={messageInputRef}
                    rows={1}
                    dir="auto"
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
                    <>
                      <button className="mic-btn" type="button" onClick={handleStartRecording} aria-label="شروع ضبط صدا">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 3.5a3 3 0 0 0-3 3V12a3 3 0 1 0 6 0V6.5a3 3 0 0 0-3-3Z" />
                          <path d="M6.5 11a.9.9 0 0 1 .9.9V12a4.6 4.6 0 0 0 9.2 0v-.1a.9.9 0 1 1 1.8 0V12a6.4 6.4 0 0 1-5.5 6.3V20h2a.9.9 0 1 1 0 1.8H9.1a.9.9 0 1 1 0-1.8h2v-1.7A6.4 6.4 0 0 1 5.6 12v-.1a.9.9 0 0 1 .9-.9Z" />
                        </svg>
                      </button>
                      <button
                        className="send-btn"
                        type="button"
                        onClick={() => void handleSendMessage()}
                        aria-label="ارسال پیام"
                        disabled={!canSendMessage}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4.3 11.3 19.5 4.7c.9-.4 1.8.5 1.4 1.4l-6.6 15.2a1 1 0 0 1-1.9-.2l-1-5.7-5.7-1a1 1 0 0 1-.2-1.9Z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </footer>
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

  return (
    <ToastProvider>
      <ChatApp />
    </ToastProvider>
  );
}

export default App;
