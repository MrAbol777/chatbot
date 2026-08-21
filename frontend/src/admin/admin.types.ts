import type { IconName } from '../components/Icon';
import type { AdminIdentity } from '../noa/noa.types';

export type { AdminIdentity };

export type AdminRole = 'superadmin' | 'admin' | 'finance' | 'moderator' | 'developer' | 'support';

export type User = {
  user_id: string;
  name: string;
  age: number;
  phone?: string;
  registered_at?: string;
  last_activity?: string;
  conversationCount?: number;
  isBanned?: boolean;
};

export type UsersPayload = {
  items: User[];
  total: number;
  page: number;
  pageSize: number;
};

export type ImageGeneration = {
  id: string;
  taskId: string;
  userId: string;
  user: { name: string; phone?: string | null; age?: number | null };
  originalPrompt: string;
  apiPrompt: string;
  status: string;
  operation: string;
  createdAt?: string;
  provider?: string | null;
  model?: string | null;
  imageUrl?: string | null;
};

export type ImageGenerationsPayload = {
  items: ImageGeneration[];
  total: number;
  page: number;
  pageSize: number;
};

export type ChatImage = {
  url: string;
  alt?: string;
};

export type ProfileMessage = {
  role: 'user' | 'assistant';
  content: string;
  type?: string;
  timestamp?: string;
  status?: string;
  taskId?: string;
  imageTaskId?: string;
  imageUrl?: string;
  resultUrl?: string;
  images?: ChatImage[];
};

export type UserProfile = User & {
  conversations: Array<{
    conversation_id: string;
    title: string;
    generated_title?: string | null;
    title_source?: 'default' | 'generated' | 'manual';
    title_generation_status?: string | null;
    title_model?: string | null;
    title_generator_version?: string | null;
    title_generation_latency_ms?: number | null;
    title_generated_at?: string | null;
    title_manually_updated_at?: string | null;
    message_count: number;
    last_message_at?: string;
    messages: ProfileMessage[];
  }>;
};

export type DashboardStats = {
  kpis: {
    totalUsers: number;
    activeUsersToday: number;
    apiCallsToday: number;
    errorCountToday: number;
  };
  userGrowth: Array<{ date: string; users: number }>;
  apiUsage: Array<{ date: string; calls: number }>;
  errorDistribution: Array<{ error_type: string; count: number }>;
  recentActivities: Array<{
    timestamp: string;
    adminUsername: string;
    action: string;
    target: string | null;
    details?: Record<string, unknown>;
  }>;
};

export type SiteSettingsPayload = {
  settings: Record<string, any>;
  definitions?: Record<string, { label: string; type: string; category: string; allowedValues?: string[] }>;
};

export type ConversationMemoryPayload = {
  conversationId: string;
  metadata?: {
    version?: number;
    status?: string;
    last_writer_status?: string;
    last_writer_model?: string;
    last_writer_duration_ms?: number;
    last_error_code?: string | null;
    updated_at?: string;
  };
  storageKey?: string;
  sizeBytes?: number;
  content: string;
};

export type AiRuntimeStatus = {
  chat: {
    provider: string;
    model?: string | null;
    baseUrlHost?: string;
    apiKeySource: string;
    apiKeySet: boolean;
    apiKeyFingerprint?: string;
  };
  image: {
    enabled?: boolean;
    provider: string;
    modelSource?: string;
    modelAdminValue: string;
    modelRuntimeValue: string;
    modelProviderName?: string;
    operation?: string;
    baseUrlHost?: string;
    apiKeySource: string;
    apiKeySet: boolean;
    apiKeyFingerprint?: string;
    resolution: string;
    aspectRatio: string;
    outputFormat: string;
    safetyFilterLevel: string;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    maxDownloadMb?: number;
    editEnabled?: boolean;
    promptEnhancerEnabled?: boolean;
    lastValidationStatus?: string;
    storageDir?: string;
    storageWritable?: boolean;
    publicServeRoute?: string;
  };
  imagePromptRefiner?: {
    enabled: boolean;
    provider: string;
    model: string;
    apiKeySource: string;
    apiKeySet: boolean;
    apiKeyFingerprint?: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    fallbackEnabled: boolean;
    cacheEnabled: boolean;
    cacheTtlMinutes: number;
    lastValidationStatus?: string;
  };
  intentRouter?: {
    enabled: boolean;
    provider: string;
    model: string;
    fallbackModel: string;
    experimentalModel: string;
    apiKeySource: string;
    apiKeySet: boolean;
    apiKeyFingerprint?: string;
    allowModelFallback: boolean;
    allowChatKeyFallback: boolean;
    fallbackToHeuristic: boolean;
    confidenceThreshold: number;
    timeoutMs: number;
    maxOutputTokens: number;
    temperature: number;
    storeMetadata: boolean;
    health: {
      enabled: boolean;
      failureThreshold: number;
      cooldownMinutes: number;
      models: Record<string, {
        status: string;
        failures?: number;
        cooldownUntil?: string | null;
        lastError?: {
          statusCode?: number | null;
          errorType?: string;
          safeMessage?: string;
          upstreamCode?: string;
        } | null;
      }>;
    };
    lastValidationStatus?: string;
  };
  vision?: {
    enabled: boolean;
    provider: string;
    mode: string;
    defaultModel: string;
    fastModel: string;
    experimentalModel?: string;
    qualityModel: string;
    proModel: string;
    allowProModel: boolean;
    apiKeySource: string;
    apiKeySet: boolean;
    apiKeyFingerprint?: string;
    transport: string;
    timeoutMs: number;
    fallbackTimeoutMs: number;
    maxImageMb: number;
    mediaResolution: string;
    temperature: number;
    maxOutputTokens: number;
    selectedModelForSimpleImage?: string;
    selectedModelForOcrOrDesign?: string;
    modelHealth?: Record<string, {
      status: string;
      failures?: number;
      cooldownUntil?: string | null;
      lastError?: {
        statusCode?: number | null;
        errorType?: string;
        safeMessage?: string;
        upstreamCode?: string;
      } | null;
    }>;
    lastValidationStatus?: string;
  };
};

export type ImageModelPreset = {
  id: string;
  label: string;
  adminValue: string;
  provider: string;
  runtimeProviderName: string;
  runtimeModel: string;
  operation: string;
  supportsImageEdit?: boolean;
  defaultResolution?: string;
};

export type SupervisedOtpConfig = {
  enabled: boolean;
  hasCode: boolean;
  expires_at?: string | null;
  max_uses?: number | null;
  used_count: number;
  updated_at?: string | null;
};

export type PromptVersion = {
  id: string;
  version: number;
  author: string;
  createdAt: string;
  note?: string;
  length: number;
  preview: string;
  prompt?: string;
};

export type FlaggedItem = {
  users: Array<{
    user_id: string;
    name: string;
    phone?: string | null;
    age: number;
    isBanned: boolean;
    createdAt?: string;
    updatedAt?: string;
  }>;
  images: Array<{
    id: string;
    taskId: string;
    userId: string;
    userName: string;
    userPhone?: string | null;
    prompt: string;
    status: string;
    createdAt?: string;
  }>;
};

export type AdminTab =
  | 'dashboard'
  | 'users'
  | 'broadcastMessages'
  | 'moderation'
  | 'imageGenerations'
  | 'videoGenerations'
  | 'noaFinance'
  | 'aiRouting'
  | 'videoPromptProfiles'
  | 'errors'
  | 'siteSettings'
  | 'supervisedOtp'
  | 'config'
  | 'audit';

export type ReportUserScope = 'all' | 'selected';
export type ReportFormat = 'csv' | 'txt';
export type ReportSection =
  | 'users'
  | 'errors'
  | 'conversation_summary'
  | 'messages'
  | 'ai_performance'
  | 'supervised_otp_usage';
export type ReportRangePreset = 'today' | '7d' | '30d' | 'custom';

export const TAB_LABELS: Record<AdminTab, string> = {
  dashboard: 'داشبورد',
  users: 'کاربران',
  broadcastMessages: 'پیام همگانی',
  moderation: 'ایمنی و نظارت',
  imageGenerations: 'خروجی‌های تصویر',
  videoGenerations: 'خروجی‌های ویدیو',
  noaFinance: 'نوآ و قیمت‌گذاری',
  aiRouting: 'ارائه‌دهندگان AI',
  videoPromptProfiles: 'پرامپت‌های ویدیو',
  errors: 'خطاها',
  siteSettings: 'تنظیمات سایت',
  supervisedOtp: 'رمز نظارتی',
  config: 'تنظیمات سیستم',
  audit: 'گزارش و ممیزی'
};

export const TAB_ICONS: Record<AdminTab, IconName> = {
  dashboard: 'grid',
  users: 'family',
  broadcastMessages: 'send',
  moderation: 'shield',
  imageGenerations: 'studio-image',
  videoGenerations: 'studio-video',
  noaFinance: 'credit-card',
  aiRouting: 'sparkle',
  videoPromptProfiles: 'studio-video',
  errors: 'info-circle',
  siteSettings: 'settings',
  supervisedOtp: 'login',
  config: 'settings',
  audit: 'book'
};

export const TAB_DESCRIPTIONS: Record<AdminTab, string> = {
  dashboard: 'شاخص‌های کلیدی، روند استفاده و آخرین فعالیت‌های سامانه',
  users: 'جست‌وجو، بررسی پروفایل و مدیریت دسترسی کاربران',
  broadcastMessages: 'ارسال پیام هدفمند و مشاهده وضعیت دریافت کاربران',
  moderation: 'پایش موارد پرچم‌گذاری‌شده، خطاهای امنیتی و سلامت محتوا',
  imageGenerations: 'پیگیری وضعیت و جزئیات خروجی‌های استودیوی تصویر',
  videoGenerations: 'مشاهده کاربر، پرامپت، تصویر ورودی و خروجی هر درخواست ویدیو',
  noaFinance: 'قیمت‌گذاری زندهٔ قابلیت‌های API، کیف‌پول‌ها، نرخ تبدیل و رسیدهای واریز',
  aiRouting: 'کنترل مسیرها، مدل‌ها و وضعیت ارائه‌دهندگان هوش مصنوعی',
  videoPromptProfiles: 'مدیریت نسخه‌ها و قواعد پرامپت‌های ساخت ویدیو',
  errors: 'بررسی خطاهای ثبت‌شده و الگوهای پرتکرار',
  siteSettings: 'کنترل تنظیمات عمومی و تجربهٔ کاربری سایت',
  supervisedOtp: 'مدیریت دسترسی نظارتی موقت و محدود',
  config: 'تنظیمات runtime، مدل‌ها، تاریخچه و دستورهای پایهٔ سامانه',
  audit: 'دریافت گزارش و مرور رویدادهای مدیریتی'
};

export const TAB_GROUPS: Array<{ label: string; items: AdminTab[] }> = [
  { label: 'نمای کلی', items: ['dashboard'] },
  { label: 'محصول و کاربران', items: ['users', 'broadcastMessages', 'moderation', 'imageGenerations', 'videoGenerations'] },
  { label: 'نوآ و پرداخت', items: ['noaFinance'] },
  { label: 'هوش مصنوعی', items: ['aiRouting', 'videoPromptProfiles'] },
  { label: 'سیستم و امنیت', items: ['errors', 'siteSettings', 'supervisedOtp', 'config', 'audit'] }
];

export const ROLE_ALLOWED_TABS: Record<AdminRole, AdminTab[]> = {
  superadmin: [
    'dashboard',
    'users',
    'broadcastMessages',
    'moderation',
    'imageGenerations',
    'videoGenerations',
    'noaFinance',
    'aiRouting',
    'videoPromptProfiles',
    'errors',
    'siteSettings',
    'supervisedOtp',
    'config',
    'audit'
  ],
  admin: [
    'dashboard',
    'users',
    'broadcastMessages',
    'moderation',
    'imageGenerations',
    'videoGenerations',
    'aiRouting',
    'videoPromptProfiles',
    'errors',
    'siteSettings',
    'supervisedOtp',
    'config',
    'audit'
  ],
  finance: ['dashboard', 'broadcastMessages', 'noaFinance'],
  moderator: ['dashboard', 'users', 'broadcastMessages', 'moderation', 'imageGenerations', 'videoGenerations'],
  developer: [
    'dashboard',
    'broadcastMessages',
    'aiRouting',
    'videoPromptProfiles',
    'errors',
    'siteSettings',
    'config',
    'audit'
  ],
  support: ['dashboard', 'users', 'broadcastMessages', 'errors']
};

export const handleAdminResponse = async (
  response: Response,
  fallback: string
): Promise<{ ok: boolean; data?: any }> => {
  if (response.status === 401) {
    window.location.href = '/admin/login';
    return { ok: false };
  }
  if (!response.ok) {
    let message = fallback;
    try {
      const payload = await response.json();
      if (payload?.error || payload?.message) message = payload.message || payload.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const data = await response.json();
  return { ok: true, data };
};
