const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  getGuestIdFromUserId,
  isGuestUserId,
  normalizeGuestId
} = require('../../repositories/GuestRepository');
const { generateUserId } = require('../../repositories/helpers');
const { getDefaultSetting } = require('../settings/defaults');
const {
  DEFAULT_IMAGE_RUNTIME_SETTINGS,
  createImageRuntimeSettingsResolver
} = require('./image-runtime-settings');

const GENERATED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const GUEST_COOKIE_NAME = 'danoa_guest_id';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_IMAGE_PROVIDER = 'metis';
const DEFAULT_IMAGE_BASE_URL = 'https://api.metisai.ir';
const DEFAULT_IMAGE_PUBLIC_BASE_URL = '/api/images/serve';
const DEFAULT_MAX_DOWNLOAD_MB = 10;
const MAX_IMAGE_EDIT_INPUTS = 4;
const DEBUG_IMAGE_PROMPTS = () => String(process.env.DEBUG_IMAGE_PROMPTS || '').toLowerCase() === 'true';
const PAYMENT_REQUIRED_MESSAGE = 'ساخت تصویر فعلاً به‌دلیل مشکل اعتبار یا دسترسی سرویس تصویر انجام نشد. لطفاً بعداً دوباره امتحان کن.';
const UNSUPPORTED_MODEL_MESSAGE = 'مدل ساخت تصویر توسط سرویس‌دهنده پشتیبانی نمی‌شود.';
const MISSING_IMAGE_API_KEY_MESSAGE = 'کلید سرویس ساخت تصویر تنظیم نشده است.';
const IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE = 'تصویر ساخته نشد. لطفاً دوباره امتحان کن.';
const IMAGE_STORAGE_FAILED_MESSAGE = 'تصویر ساخته شد، اما ذخیره‌سازی آن با مشکل روبه‌رو شد. لطفاً دوباره امتحان کن.';
const LOCAL_IMAGE_NOT_FOUND_MESSAGE = 'فایل تصویر پیدا نشد یا منقضی شده است.';
const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};
const EXTENSION_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
};
const ALLOWED_GENERATED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const USER_COMMAND_PATTERN = /بساز|درست کن|ایجاد کن|ساخت تصویر از|تصویر|عکس|برام|برای من|لطفا|لطفاً|generate|create|draw|paint|imagine/gi;
const HUMAN_REQUEST_PATTERN =
  /(?:دختر|دختربچه|دختر\s*بچه|پسر|پسربچه|پسر\s*بچه|کودک|بچه|نوجوان|آدم|انسان|شخص|زن|مرد|پرتره|چهره|girl|boy|child|kid|teen|person|human|woman|man|portrait)/i;
const CHILD_REQUEST_PATTERN = /(?:دختربچه|دختر\s*بچه|پسربچه|پسر\s*بچه|کودک|بچه|نوجوان|girl|boy|child|kid|teen)/i;
const ANIMAL_REQUEST_PATTERN = /(?:گربه|سگ|خرگوش|پرنده|اسب|ماهی|cat|dog|rabbit|bird|horse|fish)/i;

const stripContradictoryNegativePrompt = (negativePrompt, { allowsHumans = false, allowsAnimals = false } = {}) => {
  const parts = normalizeWhitespace(negativePrompt)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const filtered = parts.filter((part) => {
    const lowered = part.toLowerCase();
    if (allowsHumans && /(no\s+humans?|no\s+people|no\s+persons?|بدون\s+انسان|بدون\s+آدم|بدون\s+شخص)/i.test(lowered)) {
      return false;
    }
    if (allowsAnimals && /(no\s+animals?|بدون\s+حیوان)/i.test(lowered)) {
      return false;
    }
    return true;
  });

  return filtered.join(', ');
};

const translateCommonPersianImageTerms = (value) => {
  let text = normalizeWhitespace(value);
  const replacements = [
    [/یه|یک/g, 'a'],
    [/دختربچه|دختر\s*بچه/g, 'young girl child'],
    [/پسربچه|پسر\s*بچه/g, 'young boy child'],
    [/دختر/g, 'girl'],
    [/پسر/g, 'boy'],
    [/کودک|بچه/g, 'child'],
    [/مو\s*بلند|موبلند/g, 'long hair'],
    [/مو\s*کوتاه|موکوتاه/g, 'short hair'],
    [/مو\s*فرفری|موفرفری/g, 'curly hair'],
    [/مو\s*صاف|موصاف/g, 'straight hair'],
    [/رنگ\s*مشکی|مشکی|سیاه/g, 'black'],
    [/رنگ\s*قهوه‌ای|قهوه‌ای/g, 'brown'],
    [/رنگ\s*بلوند|بلوند/g, 'blonde'],
    [/رنگ\s*آبی|آبی/g, 'blue'],
    [/رنگ\s*قرمز|قرمز/g, 'red'],
    [/رنگ\s*سبز|سبز/g, 'green'],
    [/گربه/g, 'cat'],
    [/سگ/g, 'dog'],
    [/خرگوش/g, 'rabbit'],
    [/پرتره|چهره/g, 'portrait'],
    [/ با /g, ' with '],
    [/ و /g, ' and ']
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/long hair\s+with\s+black|long hair\s+black/gi, 'long black hair');
  text = text.replace(/short hair\s+with\s+black|short hair\s+black/gi, 'short black hair');
  return normalizeWhitespace(text);
};

const buildFinalImagePrompt = (input, options = {}) => {
  const original = normalizeWhitespace(input);
  if (options.promptEnhancerEnabled === false) {
    return original;
  }
  const lowered = original.toLowerCase();
  const hasHumanSubject = HUMAN_REQUEST_PATTERN.test(original);
  const hasChildSubject = CHILD_REQUEST_PATTERN.test(original);
  const hasAnimalSubject = ANIMAL_REQUEST_PATTERN.test(original);
  const negativePrompt = stripContradictoryNegativePrompt(options.defaultNegativePrompt || '', {
    allowsHumans: hasHumanSubject,
    allowsAnimals: hasAnimalSubject
  });
  const negativeSuffix = negativePrompt ? `, ${negativePrompt}` : '';

  if (/موز/.test(lowered) && /آبی|ابي|blue/.test(lowered)) {
    return `A single blue banana, close-up product photo, clean white background, realistic, high quality, no humans, no people, no landscape, no cliffs, no unrelated objects${negativeSuffix}`;
  }

  if (/خرگوش/.test(lowered)) {
    const color = /خاکستری|gray|grey/.test(lowered) ? 'gray ' : '';
    const outfit = /لباس|cute|کیوت|كيوت/.test(lowered) ? ' wearing a cute outfit' : '';
    return `A cute ${color}rabbit${outfit}, charming character design, soft studio lighting, clean background, high quality, no humans, no people, no unrelated objects${negativeSuffix}`;
  }

  if (/مدرسه/.test(lowered) && /اورانوس|uranus/.test(lowered)) {
    return `A futuristic school building on the planet Uranus, visible icy blue atmosphere and rings in the sky, cinematic wide shot, detailed architecture, high quality sci-fi concept art, no humans, no people, no unrelated objects${negativeSuffix}`;
  }

  const cleaned = original
    .replace(/^\/imagine\s+/i, '')
    .replace(USER_COMMAND_PATTERN, ' ')
    .replace(/[«»"]/g, ' ')
    .trim();
  const subjectText = cleaned || original;
  const translatedSubject = translateCommonPersianImageTerms(subjectText);
  const subjectGuard = hasHumanSubject
    ? 'The main subject must be the requested human/person, not an animal or object. Do not replace the person with a cat, pet, doll, mascot, or unrelated character.'
    : hasAnimalSubject
      ? 'The main subject must be the requested animal. Do not replace it with a person or unrelated object.'
      : 'Do not replace the requested subject with a different animal, person, or unrelated object.';
  const humanStyle = hasHumanSubject
    ? 'Use a respectful, natural portrait or full-body composition with realistic anatomy, expressive face, and clear visible subject.'
    : 'Use a simple coherent composition, realistic details, and strong subject focus.';
  const childSafety = hasChildSubject
    ? 'If the subject is a child, keep the image age-appropriate, wholesome, fully clothed, non-sexualized, and safe.'
    : '';
  const exclusion = hasHumanSubject
    ? 'No animals unless explicitly requested, no unrelated objects, no random landscapes unless explicitly requested.'
    : 'No humans, no people, no unrelated objects, no random landscapes unless explicitly requested.';

  return [
    'Create one clear, high-quality image that exactly matches this user request.',
    `Original user request: ${original}.`,
    `Main subject request: ${subjectText}.`,
    translatedSubject && translatedSubject !== subjectText ? `Interpreted subject details: ${translatedSubject}.` : '',
    subjectGuard,
    humanStyle,
    childSafety,
    `${exclusion}${negativePrompt ? ` Negative prompt: ${negativePrompt}.` : ''}`
  ].filter(Boolean).join(' ');
};

const buildFinalImageEditPrompt = (input, options = {}) => {
  const original = normalizeWhitespace(input);
  const editInstruction = original || 'Apply the requested edit to the input image.';
  const negativePrompt = normalizeWhitespace(options.defaultNegativePrompt || '');
  const referenceCount = Math.min(MAX_IMAGE_EDIT_INPUTS, Math.max(1, Number(options.referenceCount) || 1));
  return [
    'This is an image editing request, not a new text-to-image request.',
    'Use input image 1 as the primary base image and identity source.',
    referenceCount > 1
      ? `Input images 2 through ${referenceCount} are secondary visual references. Keep every referenced person distinct; never blend, swap, or average their faces.`
      : '',
    'Preserve the primary subject identity, facial features, age, skin tone, body characteristics, and recognizable details.',
    'Preserve pose, composition, camera angle, lighting, clothing, and style unless the user explicitly asks to change them.',
    `Change only the requested part: ${editInstruction}.`,
    'When the user asks to add another person or object, add it while keeping the original subject clearly recognizable.',
    'Do not replace the primary subject with another person, animal, object, mascot, or unrelated character.',
    'Keep the result child-friendly, natural, coherent, and high quality.',
    negativePrompt ? `Avoid: ${negativePrompt}.` : ''
  ].filter(Boolean).join(' ');
};

/**
 * Image generation controller — handles generate / status / serve routes.
 *
 * Providers return image bytes or remote image URLs. We keep the public API
 * async/polled, save completed images into configured local storage, and only
 * expose same-origin /api/images/serve/:taskId URLs to the frontend.
 */
function createImageGenerationController({
  imageGenerationService,
  imagePromptRefinerService,
  inputOptimizerService,
  db,
  plansRepository,
  settingsRepository,
  guestsRepository,
  conversationsRepository,
  eventsRepository,
  imageModelFallback,
  imageModelSourceFallback,
  imageProviderFallback,
  imageBaseUrlFallback,
  imageStorageDirFallback,
  imagePublicBaseUrlFallback,
  imageMaxDownloadMbFallback,
  imageRuntimeSettingsResolver
}) {
  const defaultStorageDir = path.join(__dirname, '../../../storage/generated-images');
  const legacyImagesDir = path.join(__dirname, '../../../uploads/images-generated');
  const getImagesDir = () => path.resolve(imageStorageDirFallback || process.env.IMAGE_STORAGE_DIR || defaultStorageDir);
  const getLegacyImagesDir = () => path.resolve(legacyImagesDir);
  const getImagePublicBaseUrl = () =>
    String(imagePublicBaseUrlFallback || process.env.IMAGE_PUBLIC_BASE_URL || DEFAULT_IMAGE_PUBLIC_BASE_URL).replace(/\/+$/, '');
  const getLocalPublicUrl = (recordId) => `${getImagePublicBaseUrl()}/${encodeURIComponent(String(recordId))}`;
  const getImageMaxDownloadBytes = () => {
    const configuredMb = Number(imageMaxDownloadMbFallback || process.env.IMAGE_MAX_DOWNLOAD_MB || DEFAULT_MAX_DOWNLOAD_MB);
    const safeMb = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : DEFAULT_MAX_DOWNLOAD_MB;
    return Math.floor(safeMb * 1024 * 1024);
  };
  const getImageMaxDownloadBytesForSettings = (imageSettings = {}) => {
    const configuredMb = Number(imageSettings.maxDownloadMb || imageMaxDownloadMbFallback || process.env.IMAGE_MAX_DOWNLOAD_MB || DEFAULT_MAX_DOWNLOAD_MB);
    const safeMb = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : DEFAULT_MAX_DOWNLOAD_MB;
    return Math.floor(safeMb * 1024 * 1024);
  };

  const normalizeLimitValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
  };

  const limitFailureMessage = (reason) => {
    if (reason === 'daily') return 'سقف ساخت تصویر امروزت تمام شده است.';
    if (reason === 'hourly') return 'فعلاً کمی صبر کن؛ سقف ساخت تصویر این ساعت پر شده است.';
    return 'ساخت تصویر برای این پلن غیرفعال است.';
  };

  const getImageLimitDiagnostics = ({ userId, isGuest, guestId, limitState }) => ({
    userId,
    guestId: guestId || getGuestIdFromUserId(userId) || '',
    planId: limitState?.plan?.id || (isGuest ? 'guest' : null),
    planName: limitState?.plan?.name || (isGuest ? 'guest' : null),
    isGuest: Boolean(isGuest),
    dailyImageLimit: limitState?.limits?.daily ?? null,
    hourlyImageLimit: limitState?.limits?.hourly ?? null,
    usedToday: limitState?.usage?.daily?.imageCount ?? null,
    usedThisHour: limitState?.usage?.hourly?.imageCount ?? null,
    enabled: Boolean(limitState?.allowed),
    disabledReason: limitState?.allowed ? null : limitState?.reason || 'unknown',
    gateSource: limitState?.gateSource || (isGuest ? 'guest.image_limit' : 'plan.image_limit')
  });

  const logImageLimitDiagnostics = (payload) => {
    console.info('[image-generation] image limit gate', payload);
  };

  const publicImageErrorMessage = (error) => {
    const message = typeof error === 'string' ? error.trim() : '';
    if (message === PAYMENT_REQUIRED_MESSAGE) return PAYMENT_REQUIRED_MESSAGE;
    if (message === UNSUPPORTED_MODEL_MESSAGE) return UNSUPPORTED_MODEL_MESSAGE;
    if (message === MISSING_IMAGE_API_KEY_MESSAGE) return MISSING_IMAGE_API_KEY_MESSAGE;
    if (message === IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE) return IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE;
    if (message === IMAGE_STORAGE_FAILED_MESSAGE) return IMAGE_STORAGE_FAILED_MESSAGE;
    if (message === LOCAL_IMAGE_NOT_FOUND_MESSAGE) return LOCAL_IMAGE_NOT_FOUND_MESSAGE;
    if (/did not return image data/i.test(message)) return IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE;
    return 'ساخت تصویر انجام نشد. مشکل از سرویس تصویر بود، نه درخواست تو. دوباره امتحان کن.';
  };

  const normalizeModelValue = (value) => (typeof value === 'string' ? value.trim() : '');
  const normalizeStringValue = (value, fallback) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
  };

  const runtimeSettingsResolver = imageRuntimeSettingsResolver || createImageRuntimeSettingsResolver({
    settingsRepository,
    imageConfig: {
      provider: imageProviderFallback,
      baseUrl: imageBaseUrlFallback,
      model: imageModelFallback,
      modelSource: imageModelSourceFallback,
      resolution: getDefaultSetting('ai.image.resolution'),
      aspectRatio: getDefaultSetting('ai.image.aspect_ratio'),
      outputFormat: getDefaultSetting('ai.image.output_format'),
      safetyFilterLevel: getDefaultSetting('ai.image.safety_filter_level'),
      maxDownloadMb: imageMaxDownloadMbFallback
    }
  });

  const resolveImageModel = async () => {
    let panelModel;
    if (settingsRepository && typeof settingsRepository.getStored === 'function') {
      panelModel = await settingsRepository.getStored('ai.image.model');
    }
    const configuredModel = normalizeModelValue(panelModel);
    if (configuredModel) {
      return {
        imageModel: configuredModel,
        modelSource: 'ai.image.model'
      };
    }

    const envModel = normalizeModelValue(imageModelFallback);
    if (envModel) {
      return {
        imageModel: envModel,
        modelSource: imageModelSourceFallback || 'IMAGE_MODEL'
      };
    }
    return {
      imageModel: DEFAULT_IMAGE_MODEL,
      modelSource: 'default'
    };
  };

  const resolveImageSettings = async () => {
    if (runtimeSettingsResolver && typeof runtimeSettingsResolver.getRuntimeSettings === 'function') {
      const runtimeSettings = await runtimeSettingsResolver.getRuntimeSettings();
      return {
        ...DEFAULT_IMAGE_RUNTIME_SETTINGS,
        imageModel: runtimeSettings.modelAdminValue,
        modelSource: runtimeSettings.modelSource,
        provider: runtimeSettings.provider,
        baseUrl: runtimeSettings.baseUrl || imageBaseUrlFallback || DEFAULT_IMAGE_BASE_URL,
        resolution: runtimeSettings.resolution,
        aspectRatio: runtimeSettings.aspectRatio,
        outputFormat: runtimeSettings.outputFormat,
        safetyFilterLevel: runtimeSettings.safetyFilterLevel,
        runtimeProviderName: runtimeSettings.runtimeProviderName,
        runtimeModel: runtimeSettings.runtimeModel,
        operation: runtimeSettings.operation,
        promptEnhancerEnabled: runtimeSettings.promptEnhancerEnabled,
        defaultNegativePrompt: runtimeSettings.defaultNegativePrompt,
        pollIntervalMs: runtimeSettings.pollIntervalMs,
        pollTimeoutMs: runtimeSettings.pollTimeoutMs,
        maxDownloadMb: runtimeSettings.maxDownloadMb,
        editEnabled: runtimeSettings.editEnabled,
        enabled: runtimeSettings.enabled,
        customArgs: runtimeSettings.customArgs,
        customArgsJson: runtimeSettings.customArgsJson,
        lastValidationStatus: runtimeSettings.lastValidationStatus
      };
    }

    const fallback = {
      imageModel: DEFAULT_IMAGE_MODEL,
      provider: imageProviderFallback || getDefaultSetting('ai.image.provider') || DEFAULT_IMAGE_PROVIDER,
      baseUrl: imageBaseUrlFallback || getDefaultSetting('ai.image.base_url') || DEFAULT_IMAGE_BASE_URL,
      resolution: getDefaultSetting('ai.image.resolution') || '1K',
      aspectRatio: getDefaultSetting('ai.image.aspect_ratio') || '1:1',
      outputFormat: getDefaultSetting('ai.image.output_format') || 'jpg',
      safetyFilterLevel: getDefaultSetting('ai.image.safety_filter_level') || 'block_only_high'
    };

    if (!settingsRepository || typeof settingsRepository.get !== 'function') {
      const resolvedModel = await resolveImageModel();
      return {
        ...fallback,
        ...resolvedModel
      };
    }

    const [resolvedModel, provider, baseUrl, resolution, aspectRatio, outputFormat, safetyFilterLevel] = await Promise.all([
      resolveImageModel(),
      settingsRepository.get('ai.image.provider'),
      settingsRepository.get('ai.image.base_url'),
      settingsRepository.get('ai.image.resolution'),
      settingsRepository.get('ai.image.aspect_ratio'),
      settingsRepository.get('ai.image.output_format'),
      settingsRepository.get('ai.image.safety_filter_level')
    ]);

    return {
      ...resolvedModel,
      provider: normalizeStringValue(provider, fallback.provider),
      baseUrl: normalizeStringValue(baseUrl, fallback.baseUrl),
      resolution: normalizeStringValue(resolution, fallback.resolution),
      aspectRatio: normalizeStringValue(aspectRatio, fallback.aspectRatio),
      outputFormat: normalizeStringValue(outputFormat, fallback.outputFormat),
      safetyFilterLevel: normalizeStringValue(safetyFilterLevel, fallback.safetyFilterLevel)
    };
  };

  const setGuestCookie = (res, guestId) => {
    res.cookie(GUEST_COOKIE_NAME, guestId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  };

  const getGuestImageLimits = async () => {
    if (!settingsRepository || typeof settingsRepository.get !== 'function') {
      return { daily: null, hourly: null };
    }
    const [daily, hourly] = await Promise.all([
      settingsRepository.get('guest.image_limit_daily'),
      settingsRepository.get('guest.image_limit_hourly')
    ]);
    return {
      daily: normalizeLimitValue(daily),
      hourly: normalizeLimitValue(hourly)
    };
  };

  const resolveUserContext = async (req, res) => {
    const authenticatedUserId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
    if (authenticatedUserId && !isGuestUserId(authenticatedUserId)) {
      return { userId: authenticatedUserId, isGuest: false, guestId: '' };
    }

    const existingGuestId = normalizeGuestId(req.cookies?.[GUEST_COOKIE_NAME] || getGuestIdFromUserId(authenticatedUserId));
    const guestId = existingGuestId || getGuestIdFromUserId(generateUserId({ isGuest: true }));
    if (!existingGuestId) {
      setGuestCookie(res, guestId);
    }

    if (!guestsRepository || typeof guestsRepository.ensureGuestUser !== 'function') {
      return { userId: generateUserId({ isGuest: true, uuid: guestId }), isGuest: true, guestId };
    }

    const guestUserId = await guestsRepository.ensureGuestUser(guestId);
    return { userId: guestUserId, isGuest: true, guestId };
  };

  const checkGuestImageLimits = async (userId) => {
    const limits = await getGuestImageLimits();
    if (limits.daily === 0 || limits.hourly === 0) {
      return {
        allowed: false,
        reason: 'disabled',
        gateSource: limits.daily === 0 ? 'guest.image_limit_daily' : 'guest.image_limit_hourly',
        plan: null,
        limits,
        limit: 0,
        usage: { daily: null, hourly: null }
      };
    }
    if (!plansRepository) {
      return { allowed: true, gateSource: 'guest.image_limit', plan: null, limits, limit: null, usage: { daily: null, hourly: null } };
    }

    const dailyUsage =
      limits.daily === null || typeof plansRepository.getDailyUsage !== 'function'
        ? null
        : await plansRepository.getDailyUsage(userId);
    if (dailyUsage && Number(dailyUsage.imageCount || 0) >= limits.daily) {
      return {
        allowed: false,
        reason: 'daily',
        gateSource: 'guest.image_limit_daily',
        plan: null,
        limits,
        limit: limits.daily,
        usage: { daily: dailyUsage, hourly: null },
        remaining: 0
      };
    }

    const hourlyUsage =
      limits.hourly === null || typeof plansRepository.getHourlyUsage !== 'function'
        ? null
        : await plansRepository.getHourlyUsage(userId);
    if (hourlyUsage && Number(hourlyUsage.imageCount || 0) >= limits.hourly) {
      return {
        allowed: false,
        reason: 'hourly',
        gateSource: 'guest.image_limit_hourly',
        plan: null,
        limits,
        limit: limits.hourly,
        usage: { daily: dailyUsage, hourly: hourlyUsage },
        remaining: 0
      };
    }

    return {
      allowed: true,
      gateSource: 'guest.image_limit',
      plan: null,
      limits,
      limit: null,
      usage: { daily: dailyUsage, hourly: hourlyUsage },
      remaining: {
        daily: dailyUsage && limits.daily !== null ? Math.max(0, limits.daily - Number(dailyUsage.imageCount || 0)) : null,
        hourly: hourlyUsage && limits.hourly !== null ? Math.max(0, limits.hourly - Number(hourlyUsage.imageCount || 0)) : null
      }
    };
  };

  const resolveImageLimitState = async ({ userId, isGuest }) => {
    if (isGuest) {
      return checkGuestImageLimits(userId);
    }
    if (plansRepository && typeof plansRepository.checkImageLimits === 'function') {
      return plansRepository.checkImageLimits(userId);
    }
    if (plansRepository && typeof plansRepository.checkLimit === 'function') {
      return plansRepository.checkLimit(userId, 'image');
    }
    return { allowed: true, plan: null, limits: { daily: null, hourly: null }, usage: { daily: null, hourly: null } };
  };

  const normalizeMimeType = (value) => String(value || '').split(';')[0].trim().toLowerCase();

  const isPathInside = (candidatePath, allowedRoot) => {
    const resolvedCandidate = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(allowedRoot);
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
  };

  const isAllowedGeneratedImagePath = (candidatePath) =>
    isPathInside(candidatePath, getImagesDir()) || isPathInside(candidatePath, getLegacyImagesDir());

  const getMimeTypeFromPath = (filePath, fallback = 'application/octet-stream') => {
    const extension = path.extname(String(filePath || '')).replace(/^\./, '').toLowerCase();
    return MIME_BY_EXTENSION[extension] || fallback;
  };

  const getUrlHost = (value) => {
    try {
      return new URL(String(value || '')).hostname;
    } catch (_error) {
      return '';
    }
  };

  const findGeneratedImage = async (recordOrId) => {
    const record = recordOrId && typeof recordOrId === 'object' ? recordOrId : { id: recordOrId };
    const recordId = record.id;
    const storedFilePath = typeof record.local_file_path === 'string' ? record.local_file_path.trim() : '';
    if (storedFilePath) {
      const fullPath = path.resolve(storedFilePath);
      if (isAllowedGeneratedImagePath(fullPath) && await fs.pathExists(fullPath)) {
        const stat = await fs.stat(fullPath);
        if (stat.isFile() && stat.size > 0) {
          return {
            fullPath,
            localPath: storedFilePath,
            mimeType: normalizeMimeType(record.mime_type) || getMimeTypeFromPath(fullPath)
          };
        }
      }
    }

    const imagesDir = getImagesDir();
    const legacyDir = getLegacyImagesDir();
    for (const baseDir of [imagesDir, legacyDir]) {
      for (const extension of GENERATED_IMAGE_EXTENSIONS) {
        const legacyName = `${recordId}.${extension}`;
        const fullPath = path.join(baseDir, legacyName);
        if (await fs.pathExists(fullPath)) {
          const stat = await fs.stat(fullPath);
          if (stat.isFile() && stat.size > 0) {
            return {
              fullPath,
              localPath: fullPath,
              mimeType: MIME_BY_EXTENSION[extension] || 'application/octet-stream'
            };
          }
        }
      }
    }
    return null;
  };

  const saveGeneratedImage = async ({ image, recordId }) => {
    if (!image?.buffer?.length) {
      throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
    }

    const mimeType = normalizeMimeType(image.mimeType || MIME_BY_EXTENSION[image.extension]);
    if (!ALLOWED_GENERATED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
    }

    const maxDownloadBytes = Number(image.maxDownloadBytes) > 0 ? Number(image.maxDownloadBytes) : getImageMaxDownloadBytes();
    if (image.buffer.length > maxDownloadBytes) {
      throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
    }

    const extension = EXTENSION_BY_MIME[mimeType] || (GENERATED_IMAGE_EXTENSIONS.includes(image.extension) ? image.extension : 'png');
    const imagesDir = getImagesDir();
    await fs.ensureDir(imagesDir);
    await fs.access(imagesDir, fs.constants.W_OK);

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeRecordId = String(recordId).replace(/[^a-zA-Z0-9_-]/g, '');
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const filename = `img_${datePart}_${safeRecordId}_${randomSuffix}.${extension}`;
    const fullPath = path.join(imagesDir, filename);
    const tempPath = `${fullPath}.tmp-${process.pid}-${Date.now()}`;

    if (!isPathInside(fullPath, imagesDir) || !isPathInside(tempPath, imagesDir)) {
      throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
    }

    try {
      await fs.writeFile(tempPath, image.buffer, { flag: 'wx' });
      await fs.rename(tempPath, fullPath);
    } catch (error) {
      await fs.remove(tempPath).catch(() => {});
      throw error;
    }

    const stat = await fs.stat(fullPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
    }

    await fs.access(fullPath, fs.constants.R_OK);
    const localPublicUrl = getLocalPublicUrl(recordId);
    console.log('[image-generation] Image saved locally', {
      recordId,
      fullPath,
      localPublicUrl,
      mimeType,
      size: stat.size
    });

    return {
      localPath: fullPath,
      fullPath,
      localPublicUrl,
      mimeType,
      fileSize: stat.size,
      filename
    };
  };

  const debugLog = (payload) => {
    if (!DEBUG_IMAGE_PROMPTS()) return;
    console.log('[image-generation][debug]', payload);
  };

  const runGenerationTask = async ({ dbRecordId, prompt, originalPrompt, imageSettings, imageInput, userId, promptRefinerMetadata = null }) => {
    const imageModel = imageSettings.imageModel;
    try {
      await db.query(`UPDATE image_generations SET status = 'RUNNING' WHERE id = ?`, [dbRecordId]);
      debugLog({
        taskId: String(dbRecordId),
        status: 'RUNNING',
        model: imageModel,
        modelSource: imageSettings.modelSource,
        runtimeProviderName: imageSettings.runtimeProviderName,
        runtimeModel: imageSettings.runtimeModel,
        operation: imageSettings.operation,
        provider: imageSettings.provider,
        resolution: imageSettings.resolution,
        aspect_ratio: imageSettings.aspectRatio,
        output_format: imageSettings.outputFormat,
        originalUserMessage: originalPrompt,
        finalImagePrompt: prompt
      });

      const image = await imageGenerationService.generateImage(prompt, {
        imageModel,
        modelSource: imageSettings.modelSource,
        runtimeProviderName: imageSettings.runtimeProviderName,
        runtimeModel: imageSettings.runtimeModel,
        operation: imageSettings.operation,
        provider: imageSettings.provider,
        baseUrl: imageSettings.baseUrl,
        resolution: imageSettings.resolution,
        aspectRatio: imageSettings.aspectRatio,
        outputFormat: imageSettings.outputFormat,
        safetyFilterLevel: imageSettings.safetyFilterLevel,
        pollIntervalMs: imageSettings.pollIntervalMs,
        pollTimeoutMs: imageSettings.pollTimeoutMs,
        customArgs: imageSettings.customArgs,
        editEnabled: imageSettings.editEnabled,
        imageInput,
        originalPrompt,
        taskId: String(dbRecordId),
        maxDownloadBytes: getImageMaxDownloadBytesForSettings(imageSettings)
      });
      const savedImage = await saveGeneratedImage({
        image: {
          ...image,
          maxDownloadBytes: getImageMaxDownloadBytesForSettings(imageSettings)
        },
        recordId: dbRecordId
      });
      const providerName = image.provider || (String(imageSettings.provider || '').toLowerCase() === 'metis' ? 'Metis' : imageSettings.provider);
      const modelAdminValue = image.modelAdminValue || imageSettings.imageModel;
      const modelRuntimeValue = image.modelRuntimeValue || image.model || imageSettings.imageModel;
      const remoteUrlHost = image.remoteImageUrlHost || getUrlHost(image.remoteImageUrl);
      const metadata = {
        taskId: String(dbRecordId),
        operation: Array.isArray(imageInput) && imageInput.length > 0 ? 'edit' : 'generate',
        referenceImageCount: Array.isArray(imageInput) ? imageInput.length : 0,
        provider: providerName,
        modelAdminValue,
        modelRuntimeValue,
        ...(promptRefinerMetadata || {}),
        metisTaskId: image.metisTaskId || null,
        remoteImageUrlHost: remoteUrlHost || null,
        localFilePath: savedImage.localPath,
        localPublicUrl: savedImage.localPublicUrl,
        mimeType: savedImage.mimeType,
        fileSize: savedImage.fileSize,
        createdAt: new Date().toISOString(),
        ownerUserId: userId,
        ownerGuestId: getGuestIdFromUserId(userId) || null
      };

      await db.query(
        `UPDATE image_generations
         SET status = 'COMPLETED',
             image_url = ?,
             local_file_path = ?,
             mime_type = ?,
             file_size = ?,
             provider = ?,
             model_admin_value = ?,
             model_runtime_value = ?,
             remote_url_host = ?,
             metadata = ?,
             error = NULL
         WHERE id = ?`,
        [
          savedImage.localPublicUrl,
          savedImage.localPath,
          savedImage.mimeType,
          savedImage.fileSize,
          providerName,
          modelAdminValue,
          modelRuntimeValue,
          remoteUrlHost || null,
          JSON.stringify(metadata),
          dbRecordId
        ]
      );

      console.log('[image-generation] task completed', {
        dbRecordId,
        localPublicUrl: savedImage.localPublicUrl,
        model: modelRuntimeValue
      });
      debugLog({
        taskId: String(dbRecordId),
        localTaskId: String(dbRecordId),
        metisTaskId: image.metisTaskId || null,
        status: 'COMPLETED',
        model: modelRuntimeValue,
        modelSource: imageSettings.modelSource,
        runtimeProviderName: imageSettings.runtimeProviderName,
        runtimeModel: modelRuntimeValue,
        operation: imageSettings.operation,
        provider: providerName,
        resolution: imageSettings.resolution,
        aspect_ratio: imageSettings.aspectRatio,
        output_format: imageSettings.outputFormat,
        originalUserMessage: originalPrompt,
        finalImagePrompt: prompt,
        remoteImageUrlHost: remoteUrlHost || null,
        localFilePathExists: true,
        localPublicUrl: savedImage.localPublicUrl,
        downloadStatus: 'saved',
        mimeType: savedImage.mimeType,
        fileSize: savedImage.fileSize
      });
      if (eventsRepository && typeof eventsRepository.logEvent === 'function') {
        await eventsRepository.logEvent(userId, 'image_generation_completed', 'image_generation', {
          taskId: String(dbRecordId),
          model: modelRuntimeValue,
          localPublicUrl: savedImage.localPublicUrl
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[image-generation] task failed', {
        dbRecordId,
        message
      });
      debugLog({
        taskId: String(dbRecordId),
        status: 'ERROR',
        model: imageModel,
        modelSource: imageSettings.modelSource,
        runtimeProviderName: imageSettings.runtimeProviderName,
        runtimeModel: imageSettings.runtimeModel,
        operation: imageSettings.operation,
        provider: imageSettings.provider,
        resolution: imageSettings.resolution,
        aspect_ratio: imageSettings.aspectRatio,
        output_format: imageSettings.outputFormat,
        originalUserMessage: originalPrompt,
        finalImagePrompt: prompt,
        errorMessage: message
      });
      try {
        await db.query(
          `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
          [message, dbRecordId]
        );
        if (eventsRepository && typeof eventsRepository.logEvent === 'function') {
          await eventsRepository.logEvent(userId, 'image_generation_failed', 'image_generation', {
            taskId: String(dbRecordId),
            error: message
          });
        }
      } catch (dbError) {
        console.error('[image-generation] failed to persist task error', {
          dbRecordId,
          message: dbError instanceof Error ? dbError.message : String(dbError)
        });
      }
    }
  };

  const createImageTask = async (req, res, { prompt, originalPrompt = '', optimizerResult = null, enhancedPrompt = '', imageInput = [], conversationId = null, parentImageId = null }) => {
    let normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const originalUserPrompt = typeof originalPrompt === 'string' && originalPrompt.trim() ? originalPrompt.trim() : normalizedPrompt;
    if (!normalizedPrompt) {
      const error = new Error('Prompt is required.');
      error.statusCode = 400;
      error.publicPayload = { success: false, error: 'Prompt is required.' };
      throw error;
    }

    const rawImageInput = Array.isArray(imageInput)
      ? imageInput.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const normalizedImageInput = [...new Set(rawImageInput)];
    if (normalizedImageInput.length > MAX_IMAGE_EDIT_INPUTS) {
      const error = new Error(`A maximum of ${MAX_IMAGE_EDIT_INPUTS} reference images is supported.`);
      error.statusCode = 400;
      error.publicPayload = {
        success: false,
        error: 'IMAGE_EDIT_TOO_MANY_INPUTS',
        maxImages: MAX_IMAGE_EDIT_INPUTS,
        message: `برای هر ویرایش حداکثر ${MAX_IMAGE_EDIT_INPUTS} تصویر مرجع بفرست.`
      };
      throw error;
    }

    const imageSettings = await resolveImageSettings();
    if (!imageSettings.enabled) {
      const error = new Error('تنظیمات ساخت تصویر ناقص است.');
      error.statusCode = 403;
      error.publicPayload = {
        success: false,
        error: 'IMAGE_GENERATION_DISABLED',
        message: 'ساخت تصویر در حال حاضر غیرفعال است.'
      };
      throw error;
    }
    if (normalizedImageInput.length > 0 && !imageSettings.editEnabled) {
      const error = new Error('ویرایش تصویر در حال حاضر غیرفعال است.');
      error.statusCode = 400;
      error.publicPayload = {
        success: false,
        error: 'IMAGE_EDIT_DISABLED',
        message: 'ویرایش تصویر در حال حاضر غیرفعال است.'
      };
      throw error;
    }

    const promptForImageModel =
      imageSettings.promptEnhancerEnabled !== false &&
      typeof enhancedPrompt === 'string' &&
      enhancedPrompt.trim().length > 0
        ? enhancedPrompt.trim()
        : normalizedPrompt;
    const hasImageInput = normalizedImageInput.length > 0;
    const fallbackPrompt = hasImageInput
      ? buildFinalImageEditPrompt(promptForImageModel, {
          defaultNegativePrompt: imageSettings.defaultNegativePrompt,
          referenceCount: normalizedImageInput.length
        })
      : buildFinalImagePrompt(promptForImageModel, {
          promptEnhancerEnabled: imageSettings.promptEnhancerEnabled,
          defaultNegativePrompt: imageSettings.defaultNegativePrompt
        });
    let finalPrompt = fallbackPrompt;
    let promptRefinerMetadata = null;
    const { userId, isGuest, guestId } = await resolveUserContext(req, res);
    if (!userId) {
      const error = new Error('Authentication required.');
      error.statusCode = 401;
      error.publicPayload = { success: false, error: 'Authentication required.' };
      throw error;
    }

    const requestedAspectRatio = typeof req.body?.aspectRatio === 'string' ? req.body.aspectRatio.trim() : '';
    const aspectRatio = ['1:1', '9:16', '16:9'].includes(requestedAspectRatio) ? requestedAspectRatio : imageSettings.aspectRatio;
    imageSettings.aspectRatio = aspectRatio;
    const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key'].trim().slice(0, 191)
      : '';
    if (idempotencyKey) {
      const [existing] = await db.query(
        `SELECT id, task_id, status FROM image_generations
         WHERE user_id = ? AND idempotency_key = ? AND deleted_at IS NULL LIMIT 1`,
        [userId, idempotencyKey]
      );
      if (existing[0]) {
        return { userId, isGuest, guestId, taskId: String(existing[0].id), providerTaskId: existing[0].task_id, status: existing[0].status, imageUrl: null, reused: true };
      }
    }

    let appliedOptimizerResult = optimizerResult;
    if (!appliedOptimizerResult && inputOptimizerService && typeof inputOptimizerService.optimizeInput === 'function') {
      appliedOptimizerResult = await inputOptimizerService.optimizeInput({
        text: originalUserPrompt,
        operationId: idempotencyKey || `image:${userId}:${Date.now()}`,
        operationType: normalizedImageInput.length > 0 ? 'image_edit' : 'image_generation',
        conversationId,
        userId,
        guestId,
        hasImages: normalizedImageInput.length > 0
      });
      if (appliedOptimizerResult.needsClarification) {
        const error = new Error('INPUT_CLARIFICATION_REQUIRED');
        error.statusCode = 409;
        error.publicPayload = {
          success: false,
          error: 'INPUT_CLARIFICATION_REQUIRED',
          needsClarification: true,
          message: appliedOptimizerResult.clarificationQuestionFa
        };
        throw error;
      }
      normalizedPrompt = appliedOptimizerResult.optimizedTextEn || normalizedPrompt;
    }

    const limitState = await resolveImageLimitState({ userId, isGuest });
    const limitDiagnostics = getImageLimitDiagnostics({ userId, isGuest, guestId, limitState });
    logImageLimitDiagnostics(limitDiagnostics);
    if (!limitState.allowed) {
      const error = new Error(limitFailureMessage(limitState.reason || 'daily'));
      error.userId = userId;
      error.statusCode = isGuest ? 403 : 402;
      error.publicPayload = {
        success: false,
        error: limitState.reason === 'disabled' ? 'IMAGE_GENERATION_DISABLED' : 'IMAGE_LIMIT_REACHED',
        reason: limitState.reason || 'daily',
        message: limitFailureMessage(limitState.reason || 'daily'),
        plan: limitState.plan?.id || null,
        limits: limitState.limits || null,
        limit: limitState.limit,
        usage: limitState.usage,
        diagnostics: limitDiagnostics
      };
      throw error;
    }

    if (imagePromptRefinerService && typeof imagePromptRefinerService.refine === 'function') {
      const imageMode = hasImageInput ? 'image-edit' : 'text-to-image';
      const refineResult = await imagePromptRefinerService.refine({
        userPrompt: promptForImageModel,
        conversationContext: typeof req.body?.conversationContext === 'string' ? req.body.conversationContext : '',
        imageMode,
        locale: 'fa',
        imageSettings
      });
      const refinerSettings = typeof imagePromptRefinerService.getSettings === 'function'
        ? await imagePromptRefinerService.getSettings().catch(() => ({ storeMetadata: true }))
        : { storeMetadata: true };
      if (refineResult.ok) {
        const mergedNegativePrompt = typeof imagePromptRefinerService.mergeNegativePrompts === 'function'
          ? imagePromptRefinerService.mergeNegativePrompts(imageSettings.defaultNegativePrompt, refineResult.negativePrompt)
          : [imageSettings.defaultNegativePrompt, refineResult.negativePrompt].filter(Boolean).join(', ');
        finalPrompt = hasImageInput
          ? buildFinalImageEditPrompt(refineResult.refinedPrompt, {
              defaultNegativePrompt: mergedNegativePrompt,
              referenceCount: normalizedImageInput.length
            })
          : typeof imagePromptRefinerService.buildFinalPromptWithNegative === 'function'
            ? imagePromptRefinerService.buildFinalPromptWithNegative({
                refinedPrompt: refineResult.refinedPrompt,
                negativePrompt: mergedNegativePrompt
              })
            : `${refineResult.refinedPrompt}\n\nNegative prompt: ${mergedNegativePrompt}`;
        refineResult.negativePrompt = mergedNegativePrompt;
      } else {
        finalPrompt = refineResult.refinedPrompt || fallbackPrompt;
      }
      if (refinerSettings.storeMetadata !== false) {
        promptRefinerMetadata = {
          originalUserPrompt,
          inputOptimizer: appliedOptimizerResult ? {
            status: appliedOptimizerResult.status,
            fallbackUsed: Boolean(appliedOptimizerResult.fallbackUsed),
            ambiguityLevel: appliedOptimizerResult.ambiguityLevel || 'none'
          } : null,
          refinedPrompt: refineResult.ok ? refineResult.refinedPrompt : finalPrompt,
          negativePrompt: refineResult.negativePrompt || imageSettings.defaultNegativePrompt || '',
          promptRefiner: {
            enabled: refineResult.metadata?.enabled !== false,
            provider: refineResult.metadata?.provider || undefined,
            model: refineResult.metadata?.model || undefined,
            status: refineResult.status || refineResult.metadata?.status || 'fallback',
            durationMs: refineResult.metadata?.durationMs ?? refineResult.durationMs ?? null,
            apiKeySource: refineResult.metadata?.apiKeySource || undefined,
            cache: refineResult.metadata?.cache || undefined
          },
          detectedSubject: refineResult.detectedSubject || null,
          hasHumanSubject: Boolean(refineResult.hasHumanSubject),
          hasChildSubject: Boolean(refineResult.hasChildSubject),
          containsTextInImage: Boolean(refineResult.containsTextInImage),
          textToRender: refineResult.textToRender || null
        };
      }
    }

    const providerTaskId = `image-${uuidv4()}`;
    const [insertResult] = await db.query(
      `INSERT INTO image_generations
       (user_id, task_id, prompt, original_prompt, refined_prompt, aspect_ratio, operation,
        conversation_id, parent_image_id, idempotency_key, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUE')`,
      [userId, providerTaskId, finalPrompt, originalUserPrompt, finalPrompt, aspectRatio,
       hasImageInput ? 'edit' : 'generate', conversationId, parentImageId, idempotencyKey || null]
    );
    const dbRecordId = insertResult.insertId;
    const taskId = String(dbRecordId);

    if (plansRepository && typeof plansRepository.incrementUsage === 'function') {
      await plansRepository.incrementUsage(userId, 'image', 1);
    } else if (plansRepository && typeof plansRepository.incrementDailyUsage === 'function') {
      await plansRepository.incrementDailyUsage(userId, 'image', 1);
    }

      console.log('[image-generation] task created', {
      taskId,
      providerTaskId,
      userId,
      model: imageSettings.imageModel,
      modelSource: imageSettings.modelSource,
      runtimeProviderName: imageSettings.runtimeProviderName,
      runtimeModel: imageSettings.runtimeModel,
      operation: imageSettings.operation,
      provider: imageSettings.provider,
      resolution: imageSettings.resolution,
      aspectRatio: imageSettings.aspectRatio,
      promptLength: finalPrompt.length,
      promptEnhanced: promptForImageModel !== normalizedPrompt,
      referenceImageCount: normalizedImageInput.length
    });
    debugLog({
      taskId,
      status: 'QUEUE',
      model: imageSettings.imageModel,
      modelSource: imageSettings.modelSource,
      runtimeProviderName: imageSettings.runtimeProviderName,
      runtimeModel: imageSettings.runtimeModel,
      operation: imageSettings.operation,
      provider: imageSettings.provider,
      resolution: imageSettings.resolution,
      aspect_ratio: imageSettings.aspectRatio,
      output_format: imageSettings.outputFormat,
      originalUserMessage: normalizedPrompt,
      enhancedUserMessage: promptForImageModel !== normalizedPrompt ? promptForImageModel : null,
      finalImagePrompt: finalPrompt
    });

    setImmediate(() => {
      void runGenerationTask({ dbRecordId, prompt: finalPrompt, originalPrompt: normalizedPrompt, imageSettings, imageInput: normalizedImageInput, userId, promptRefinerMetadata });
    });

    return {
      userId,
      isGuest,
      guestId,
      taskId,
      providerTaskId,
      status: 'QUEUE',
      imageUrl: null
    };
  };

  /**
   * POST /api/images/generate
   */
  const generateImage = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const task = await createImageTask(req, res, { prompt, conversationId: req.body?.conversationId || null });

      return res.status(202).json({
        success: true,
        taskId: task.taskId,
        message: 'Image generation started.'
      });
    } catch (error) {
      console.error('[image-generation] generateImage failed:', error instanceof Error ? error.message : String(error));
      return res.status(error?.statusCode || 500).json(error?.publicPayload || {
        success: false,
        error: 'IMAGE_GENERATION_FAILED',
        message: 'ساخت تصویر انجام نشد. لطفاً دوباره تلاش کن.'
      });
    }
  };

  const serializeImage = (record) => {
    let imageUrl = null;
    if (record.status === 'COMPLETED') {
      const hasLocalFile = typeof record.local_file_path === 'string' && record.local_file_path.trim().length > 0;
      const hasExternalUrl = typeof record.image_url === 'string' && record.image_url.trim().length > 0;
      if (hasLocalFile) {
        imageUrl = getLocalPublicUrl(record.id);
      } else if (hasExternalUrl) {
        imageUrl = record.image_url.trim();
      }
    }
    return {
      id: String(record.id),
      taskId: String(record.id),
      originalPrompt: record.original_prompt || record.prompt || '',
      refinedPrompt: record.refined_prompt || record.prompt || '',
      model: record.model_runtime_value || record.model_admin_value || null,
      aspectRatio: record.aspect_ratio || '1:1',
      operation: record.operation || 'generate',
      conversationId: record.conversation_id || null,
      parentImageId: record.parent_image_id ? String(record.parent_image_id) : null,
      status: record.status,
      imageUrl,
      error: record.status === 'ERROR' ? publicImageErrorMessage(record.error) : null,
      createdAt: record.created_at,
      updatedAt: record.updated_at
    };
  };

  const listImages = async (req, res) => {
    try {
      const { userId } = await resolveUserContext(req, res);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 24));
      const cursor = Math.max(0, Number(req.query.cursor) || 0);
      const [rows] = await db.query(
        `SELECT * FROM image_generations WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [userId, limit + 1, cursor]
      );
      return res.json({ success: true, items: rows.slice(0, limit).map(serializeImage), nextCursor: rows.length > limit ? cursor + limit : null });
    } catch (error) {
      console.error('[image-generation] list failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'دریافت تصاویر انجام نشد.' });
    }
  };

  const getImageDetails = async (req, res) => {
    const { userId } = await resolveUserContext(req, res);
    const [rows] = await db.query(`SELECT * FROM image_generations WHERE (id = ? OR task_id = ?) AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [req.params.taskId, req.params.taskId, userId]);
    return rows[0] ? res.json({ success: true, item: serializeImage(rows[0]) }) : res.status(404).json({ success: false, error: 'تصویر پیدا نشد.' });
  };

  const deleteImage = async (req, res) => {
    const { userId } = await resolveUserContext(req, res);
    const [result] = await db.query(`UPDATE image_generations SET deleted_at = NOW() WHERE (id = ? OR task_id = ?) AND user_id = ? AND deleted_at IS NULL`, [req.params.taskId, req.params.taskId, userId]);
    return result.affectedRows ? res.status(204).end() : res.status(404).json({ success: false, error: 'تصویر پیدا نشد.' });
  };

  const editImage = async (req, res) => {
    try {
      const source = await getEditableImageInput(req, res, String(req.body?.sourceImageId || ''));
      if (!source) return res.status(404).json({ success: false, error: 'تصویر مبدا پیدا نشد.' });
      const task = await createImageTask(req, res, { prompt: req.body?.prompt, imageInput: [source.dataUrl], parentImageId: Number(source.imageId) });
      return res.status(202).json({ success: true, taskId: task.taskId, status: task.status });
    } catch (error) {
      return res.status(error?.statusCode || 500).json(error?.publicPayload || { success: false, error: 'ویرایش تصویر انجام نشد.' });
    }
  };

  /**
   * GET /api/images/status/:taskId
   */
  const getImageStatus = async (req, res) => {
    try {
      const { taskId } = req.params;
      const { userId } = await resolveUserContext(req, res);

      if (!taskId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      const [rows] = await db.query(
        `SELECT id, task_id, prompt, status, image_url, local_file_path, mime_type, file_size,
                provider, model_admin_value, model_runtime_value, remote_url_host, metadata,
                error, created_at, updated_at
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }

      const record = rows[0];
      const imageUrlPath = getLocalPublicUrl(record.id);

      if (record.status === 'COMPLETED') {
        const generatedImage = await findGeneratedImage(record);
        if (!generatedImage) {
          await db.query(
            `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
            [LOCAL_IMAGE_NOT_FOUND_MESSAGE, record.id]
          );
          return res.json({
            success: true,
            taskId: String(record.id),
            status: 'ERROR',
            imageUrl: null,
            source: 'local',
            error: LOCAL_IMAGE_NOT_FOUND_MESSAGE
          });
        }

        if (conversationsRepository && typeof conversationsRepository.updateImageTaskMessage === 'function') {
          await conversationsRepository.updateImageTaskMessage(userId, req.query?.conversationId, String(record.id), {
            type: 'image_result',
            content: 'تصویر آماده شد.',
            status: 'COMPLETED',
            images: [{ url: imageUrlPath, alt: record.prompt || 'تصویر ساخته شده' }]
          });
        }

        return res.json({
          success: true,
          taskId: String(record.id),
          status: 'COMPLETED',
          imageUrl: imageUrlPath,
          source: 'local',
          error: null
        });
      }

      if (record.status === 'ERROR') {
        const publicMessage = publicImageErrorMessage(record.error);
        if (conversationsRepository && typeof conversationsRepository.updateImageTaskMessage === 'function') {
          await conversationsRepository.updateImageTaskMessage(userId, req.query?.conversationId, String(record.id), {
            type: 'image_error',
            content: publicMessage,
            status: 'ERROR',
            images: undefined
          });
        }
        return res.json({
          success: true,
          taskId: String(record.id),
          status: 'ERROR',
          imageUrl: null,
          source: 'local',
          error: publicMessage
        });
      }

      return res.json({
        success: true,
        taskId: String(record.id),
        status: record.status || 'QUEUE',
        imageUrl: null,
        source: 'local',
        error: null
      });
    } catch (error) {
      console.error('[image-generation] getImageStatus failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'Failed to fetch task status.' });
    }
  };

  const getImageResult = async (req, res) => {
    try {
      const { taskId } = req.params;
      const { userId } = await resolveUserContext(req, res);
      if (!taskId || !userId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      const [rows] = await db.query(
        `SELECT id, task_id, status, image_url, local_file_path, mime_type, file_size
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }

      const record = rows[0];
      if (record.status !== 'COMPLETED') {
        return res.status(409).json({ success: false, error: 'Image is not ready.' });
      }

      const generatedImage = await findGeneratedImage(record);
      if (!generatedImage) {
        return res.status(404).json({ success: false, error: LOCAL_IMAGE_NOT_FOUND_MESSAGE });
      }

      res.setHeader('Content-Type', generatedImage.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return fs.createReadStream(generatedImage.fullPath).pipe(res);
    } catch (error) {
      console.error('[image-generation] getImageResult failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'Failed to fetch image.' });
    }
  };

  const serveImage = async (req, res) => {
    return getImageResult(req, res);
  };

  const getEditableImageInput = async (req, res, taskId) => {
    const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
    if (!normalizedTaskId) return null;

    const { userId } = await resolveUserContext(req, res);
    if (!userId) return null;

    const [rows] = await db.query(
      `SELECT id, task_id, status, local_file_path, mime_type, file_size
       FROM image_generations
       WHERE (id = ? OR task_id = ?) AND user_id = ?
       LIMIT 1`,
      [normalizedTaskId, normalizedTaskId, userId]
    );
    if (rows.length === 0 || rows[0].status !== 'COMPLETED') return null;

    const generatedImage = await findGeneratedImage(rows[0]);
    if (!generatedImage) return null;

    const stat = await fs.stat(generatedImage.fullPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > getImageMaxDownloadBytes()) {
      return null;
    }

    const buffer = await fs.readFile(generatedImage.fullPath);
    return {
      imageId: String(rows[0].id),
      mimeType: generatedImage.mimeType,
      dataUrl: `data:${generatedImage.mimeType};base64,${buffer.toString('base64')}`
    };
  };

  return {
    createImageTask,
    resolveUserContext,
    getEditableImageInput,
    generateImage,
    editImage,
    listImages,
    getImageDetails,
    deleteImage,
    getImageStatus,
    getImageResult,
    serveImage
  };
}

module.exports = { createImageGenerationController, buildFinalImageEditPrompt, buildFinalImagePrompt };
