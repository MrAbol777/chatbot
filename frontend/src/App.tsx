import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Conversation, UserProfile } from './types';

const PROFILE_KEY = 'chat_profile';
const CONVERSATIONS_KEY = 'chat_conversations';
const ACTIVE_CONVERSATION_KEY = 'chat_active_conversation_id';
const DEFAULT_TITLE = 'گفتگوی جدید';
const WAITING_MESSAGES = [
  'در حال یافتن پاسخ',
  'در حال بررسی سوال شما',
  'نزدیک به پایان',
  'لحظاتی دیگر پاسخ می دهم'
];
const CHAT_REQUEST_TIMEOUT_MS = 35000;
const CHAT_MAX_RETRIES = 1;

type AppProfile = UserProfile & { id?: number | string };
type RecordingAction = 'idle' | 'confirm' | 'cancel';

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const RETRYABLE_API_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const PERSIAN_PHONE_REGEX = /^09[0-9]{9}$/;

const postChatWithRetry = async (payload: {
  message: string;
  profile: UserProfile;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId?: string;
}) => {
  for (let attempt = 0; attempt <= CHAT_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/chat', {
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

const buildRequestErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string; details?: string };
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // ignore invalid json bodies and use fallback message.
  }

  if (response.status === 401 || response.status === 403) {
    return 'احراز هویت API نامعتبر است. لطفاً کلید API را در بک اند بررسی کن.';
  }

  return 'پاسخ سرور دریافت نشد.';
};

const sendVerificationCode = async (phone: string): Promise<void> => {
  const response = await fetch('/api/send-verification-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });

  if (!response.ok) {
    const errorMessage = await buildRequestErrorMessage(response);
    throw new Error(errorMessage || 'ارسال کد تایید انجام نشد.');
  }
};

const verifyCode = async (phone: string, code: string): Promise<void> => {
  const response = await fetch('/api/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code })
  });

  if (!response.ok) {
    const errorMessage = await buildRequestErrorMessage(response);
    throw new Error(errorMessage || 'تایید کد انجام نشد.');
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

const inferTitle = (text: string): string => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return DEFAULT_TITLE;
  }
  const words = cleaned.split(' ').slice(0, 5).join(' ');
  return words.length > 28 ? `${words.slice(0, 28)}...` : words;
};

const generateUniqueId = () => Date.now() + Math.floor(Math.random() * 10000);

function App() {
  const [profile, setProfile] = useState<AppProfile | null>(null);

  const [registrationStep, setRegistrationStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; age?: string; phone?: string; code?: string }>({});

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileFormName, setProfileFormName] = useState('');
  const [profileFormAge, setProfileFormAge] = useState('');
  const [profileFormErrors, setProfileFormErrors] = useState<{ name?: string; age?: string }>({});

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [waitingTextIndex, setWaitingTextIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

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

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const orderedConversations = useMemo(() => sortConversations(conversations), [conversations]);
  const lastAssistantMessageIndex = useMemo(
    () => (activeConversation ? activeConversation.messages.map((item) => item.role).lastIndexOf('assistant') : -1),
    [activeConversation]
  );

  useEffect(() => {
    try {
      const rawProfile = localStorage.getItem(PROFILE_KEY);
      const rawConversations = localStorage.getItem(CONVERSATIONS_KEY);
      const savedActiveConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);

      if (rawProfile) {
        const parsedProfile = JSON.parse(rawProfile) as AppProfile;
        if (
          parsedProfile &&
          typeof parsedProfile.name === 'string' &&
          Number.isFinite(Number(parsedProfile.age))
        ) {
          const normalizedProfile: AppProfile = {
            ...parsedProfile,
            age: Number(parsedProfile.age),
            phone:
              typeof parsedProfile.phone === 'string' && PERSIAN_PHONE_REGEX.test(parsedProfile.phone.trim())
                ? parsedProfile.phone.trim()
                : undefined,
            id: parsedProfile.id ?? generateUniqueId()
          };
          setProfile(normalizedProfile);
          localStorage.setItem(PROFILE_KEY, JSON.stringify(normalizedProfile));
        } else {
          localStorage.removeItem(PROFILE_KEY);
        }
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
      alert('دسترسی به میکروفن برقرار نشد. لطفاً دوباره تلاش کن.');
    };

    recognition.onend = () => {
      if (recordingActionRef.current === 'idle' && keepRecordingRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          keepRecordingRef.current = false;
          setIsRecording(false);
          alert('ضبط برای مدت طولانی ادامه پیدا نکرد. لطفاً دوباره تلاش کن.');
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
  }, []);

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

    try {
      await sendVerificationCode(trimmedPhone);

      setVerificationCode('');
      setErrors({});
      setRegistrationStep(3);
    } catch (error) {
      setErrors({
        phone:
          error instanceof Error && error.message.trim()
            ? error.message
            : 'ارسال کد تایید با خطا مواجه شد. لطفاً دوباره تلاش کن.'
      });
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedPhone = phone.trim();
    const trimmedCode = verificationCode.trim();
    const nextErrors: { code?: string } = {};

    if (!/^[0-9]{6}$/.test(trimmedCode)) {
      nextErrors.code = 'کد تایید باید 6 رقم باشد.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsVerifyingCode(true);

    try {
      await verifyCode(trimmedPhone, trimmedCode);

      const payload: AppProfile = {
        name: name.trim(),
        age: Number(age),
        phone: trimmedPhone,
        id: generateUniqueId()
      };

      setProfile(payload);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(payload));
    } catch (error) {
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
    if (!content) {
      return;
    }

    const currentConversation = ensureConversation();
    const userMessage: ChatMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };

    const updatedMessages = [...currentConversation.messages, userMessage];
    const nextTitle =
      currentConversation.title === DEFAULT_TITLE && currentConversation.messages.length === 0
        ? inferTitle(content)
        : currentConversation.title;

    updateConversation(currentConversation.id, (item) => ({
      ...item,
      title: nextTitle,
      messages: updatedMessages,
      updatedAt: new Date().toISOString()
    }));

    setInputValue('');
    setIsSending(true);

    try {
      const history = updatedMessages.map((msg) => ({
        role: msg.role,
        content: msg.content
      }));

      const response = await postChatWithRetry({
        message: content,
        profile,
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
      const fallbackText =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'یه مشکل کوچولو پیش اومد. چند لحظه دیگه دوباره تلاش می کنیم.';
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: fallbackText,
        timestamp: new Date().toISOString()
      };

      updateConversation(currentConversation.id, (item) => ({
        ...item,
        messages: [...item.messages, errorMessage],
        updatedAt: new Date().toISOString()
      }));
    } finally {
      setIsSending(false);
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

  const handleLogout = () => {
    const confirmed = window.confirm('از حساب خارج می شوی؟ همه اطلاعات گفتگو پاک می شود.');
    if (!confirmed) {
      return;
    }

    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(CONVERSATIONS_KEY);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);

    setProfile(null);
    setRegistrationStep(1);
    setName('');
    setAge('');
    setPhone('');
    setVerificationCode('');
    setErrors({});
    setConversations([]);
    setActiveConversationId('');
    setSidebarOpen(false);
    setInputValue('');
    setIsSending(false);
    setIsRecording(false);
  };

  const handleStartRecording = () => {
    if (!recognitionRef.current) {
      alert('مرورگر تو از ضبط صدا پشتیبانی نمی کند.');
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
      alert('فعلاً نتوانستم ضبط را شروع کنم. دوباره امتحان کن.');
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
    setShowProfileModal(false);
  };

  if (!profile) {
    return (
      <div className="app-shell auth-shell">
        <div className="bg-blob blob-pink" />
        <div className="bg-blob blob-orange" />
        <div className="bg-blob blob-yellow" />
        <div className="bg-blob blob-purple" />

        {registrationStep === 1 ? (
          <form className="register-card" onSubmit={handleRegisterStepOne}>
            <h1>
              سلام رفیق! <span>✨</span>
            </h1>
            <p className="subtitle">دانوآ، همون دوستی که همیشه برات می‌مونه!</p>
            <p className="helper onboarding-help">مرحله 1 از 3: نام و سن را وارد کن ✨</p>

            <label>
              نام
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="مثلا: علی"
                type="text"
                autoComplete="name"
              />
              {errors.name ? <small className="error">{errors.name}</small> : null}
            </label>

            <label>
              سن
              <input
                value={age}
                onChange={(event) => setAge(event.target.value)}
                placeholder="فقط عدد"
                type="number"
                min={8}
                max={18}
                inputMode="numeric"
              />
              <small className="hint">محدوده سنی مجاز: 8 تا 18 سال</small>
              {errors.age ? <small className="error">{errors.age}</small> : null}
            </label>

            <button type="submit" className="start-btn">
              ادامه
            </button>
          </form>
        ) : registrationStep === 2 ? (
          <form className="register-card" onSubmit={handleRegisterStepTwo}>
            <h1>
              تقریبا تمومه! <span>📱</span>
            </h1>
            <p className="subtitle">مرحله 2 از 3: شماره موبایل را وارد کن</p>
            <p className="helper onboarding-help">
              یک کد 6 رقمی شبیه سازی شده در کنسول بک اند لاگ می شود.
            </p>

            <label>
              شماره موبایل
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="09123456789"
                type="tel"
                inputMode="numeric"
                maxLength={11}
                autoComplete="tel"
              />
              <small className="hint">فرمت معتبر: 09XXXXXXXXX</small>
              {errors.phone ? <small className="error">{errors.phone}</small> : null}
            </label>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="danger"
                style={{ flex: 1 }}
                onClick={() => {
                  setRegistrationStep(1);
                  setErrors({});
                }}
              >
                بازگشت
              </button>
              <button type="submit" className="start-btn" style={{ flex: 2 }} disabled={isSendingVerification}>
                {isSendingVerification ? 'در حال ارسال...' : 'ادامه'}
              </button>
            </div>
          </form>
        ) : (
          <form className="register-card" onSubmit={handleVerifyCode}>
            <h1>
              کد را وارد کن <span>✅</span>
            </h1>
            <p className="subtitle">مرحله 3 از 3: کد 6 رقمی تأیید</p>
            <p className="helper onboarding-help">کد در کنسول بک‌اند ثبت شده است.</p>

            <label>
              کد تایید
              <input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="123456"
                type="tel"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
              />
              {errors.code ? <small className="error">{errors.code}</small> : null}
            </label>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="danger"
                style={{ flex: 1 }}
                onClick={() => {
                  setRegistrationStep(2);
                  setVerificationCode('');
                  setErrors({});
                }}
              >
                تغییر شماره
              </button>
              <button type="submit" className="start-btn" style={{ flex: 2 }} disabled={isVerifyingCode}>
                {isVerifyingCode ? 'در حال بررسی...' : 'تأیید'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell chat-shell">
      <div className="bg-blob blob-pink" />
      <div className="bg-blob blob-orange" />
      <div className="bg-blob blob-yellow" />
      <div className="bg-blob blob-purple" />

      <div className="chat-card">
        <header className="top-bar">
          <button className="menu-btn" onClick={() => setSidebarOpen((prev) => !prev)} type="button" aria-label="منو">
            ☰
          </button>
          <div className="top-title">
            <span className="avatar">🧠</span>
            <div>
              <strong>
                سلام {profile.name}👋
              </strong>
            </div>
          </div>
        </header>

        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-head">
            <h3>گفتگوها</h3>
            <button type="button" onClick={handleCreateConversation}>
              + گفتگوی جدید
            </button>
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
                          className="rename-input"
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
                    <button
                      type="button"
                      title="سنجاق"
                      className={conversation.pinned ? 'pinned' : ''}
                      onClick={() =>
                        updateConversation(conversation.id, (item) => ({
                          ...item,
                          pinned: !item.pinned,
                          updatedAt: new Date().toISOString()
                        }))
                      }
                    >
                      📌
                    </button>
                    <button
                      type="button"
                      title="تغییر نام"
                      onClick={() => {
                        setEditingId(conversation.id);
                        setEditingTitle(conversation.title);
                      }}
                    >
                      ✏️
                    </button>
                    <button type="button" title="حذف" onClick={() => handleDeleteConversation(conversation.id)}>
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sidebar-footer">
            <button type="button" onClick={() => setShowProfileModal(true)}>
              <span aria-hidden="true">⚙️</span>
              تنظیمات پروفایل
            </button>
            <button type="button" className="danger" onClick={handleDeleteAllConversations}>
              <span aria-hidden="true">🗑️</span>
              حذف همه گفتگوها
            </button>
            <button type="button" className="danger" onClick={handleLogout}>
              <span aria-hidden="true">🚪</span>
              خروج ار حساب کاربری
            </button>
          </div>
        </aside>

        {showProfileModal ? (
          <div className="modal-overlay" onClick={() => setShowProfileModal(false)} role="presentation">
            <div className="modal-content" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <h3>تنظیمات پروفایل</h3>

              <label>
                نام
                <input type="text" value={profileFormName} onChange={(event) => setProfileFormName(event.target.value)} />
                {profileFormErrors.name ? <small className="error">{profileFormErrors.name}</small> : null}
              </label>

              <label>
                سن
                <input
                  type="number"
                  min={8}
                  max={18}
                  inputMode="numeric"
                  value={profileFormAge}
                  onChange={(event) => setProfileFormAge(event.target.value)}
                />
                {profileFormErrors.age ? <small className="error">{profileFormErrors.age}</small> : null}
              </label>

              <label>
                شماره موبایل
                <input type="text" value={profile.phone || '-'} readOnly />
                <small className="helper">شماره موبایل فقط هنگام ثبت نام تعیین می شود.</small>
              </label>

              <div className="profile-id-box">
                <span>شناسه یکتا:</span>
                <code>{String(profile.id ?? '')}</code>
              </div>

              <div className="parent-panel-soon">پنل والد به زودی فعال می‌شود</div>

              <div className="modal-buttons">
                <button type="button" className="start-btn" onClick={handleSaveProfileSettings}>
                  ذخیره تغییرات
                </button>
                <button type="button" className="danger" onClick={() => setShowProfileModal(false)}>
                  انصراف
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {sidebarOpen ? <button className="backdrop" type="button" onClick={() => setSidebarOpen(false)} /> : null}

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
                {message.role === 'assistant' ? (
                  <span className="bot-avatar">
                    <img src="/image.png" alt="پروفایل ربات" />
                  </span>
                ) : null}
                {message.role === 'assistant' ? (
                  <div className="bubble markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="bubble">{message.content}</div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">هر چی دوست داری بنویس تا با هم شروع کنیم 🌟</div>
          )}

          {isSending ? (
            <div className="message-row assistant" ref={lastMessageRef}>
              <span className="bot-avatar">
                <img src="/image.png" alt="پروفایل ربات" />
              </span>
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
          <div className="chips-row">
            <button type="button" onClick={() => void handleSendMessage('📚 کمک درسی')}>
              📚 کمک درسی
            </button>
            <button type="button" onClick={() => void handleSendMessage('💬 احساسات')}>
              💬 احساسات
            </button>
            <button type="button" onClick={() => void handleSendMessage('✨ داستان')}>
              ✨ داستان
            </button>
          </div>

          <div className="input-row">
            <textarea
              ref={messageInputRef}
              rows={1}
              value={inputValue}
              disabled={isRecording}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSendMessage();
                }
              }}
              placeholder={isRecording ? 'در حال ضبط صدا...' : 'پیامت را اینجا بنویس...'}
              aria-label="نوشتن پیام"
            />

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
                <button className="send-btn" type="button" onClick={() => void handleSendMessage()} aria-label="ارسال پیام">
                  ارسال
                </button>
                <button className="mic-btn" type="button" onClick={handleStartRecording} aria-label="شروع ضبط صدا">
                  🎤 صدا
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
