/**
 * Image generation service — calls Google Gemini or Metis image APIs.
 *
 * The public app contract remains async/polled at our API boundary, but Gemini
 * image generation itself is a single generateContent request handled by the
 * controller's background worker.
 */
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const UNSUPPORTED_MODEL_MESSAGE = 'مدل ساخت تصویر توسط سرویس‌دهنده پشتیبانی نمی‌شود.';
const PAYMENT_REQUIRED_MESSAGE = 'ساخت تصویر فعلاً به‌دلیل مشکل اعتبار یا دسترسی سرویس تصویر انجام نشد. لطفاً بعداً دوباره امتحان کن.';
const MISSING_IMAGE_API_KEY_MESSAGE = 'کلید سرویس ساخت تصویر تنظیم نشده است.';
const IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE = 'تصویر ساخته نشد. لطفاً دوباره امتحان کن.';
const IMAGE_STORAGE_FAILED_MESSAGE = 'تصویر ساخته شد، اما ذخیره‌سازی آن با مشکل روبه‌رو شد. لطفاً دوباره امتحان کن.';
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_EDIT_INPUTS = 4;
const { buildMetisRequestBody } = require('./image-runtime-settings');
const FormData = require('form-data');

const IMAGE_MODEL_ALIASES = {
  'nano-banana-pro': {
    gemini: 'gemini-3-pro-image',
    metis: 'nano-banana-pro'
  },
  'gemini-3-pro-image': {
    gemini: 'gemini-3-pro-image',
    metis: 'nano-banana-pro'
  },
  'nano-banana': {
    gemini: 'gemini-2.5-flash-image',
    metis: 'nano-banana'
  },
  'gemini-2.5-flash-image': {
    gemini: 'gemini-2.5-flash-image',
    metis: 'nano-banana'
  },
  'gemini-2.5-flash-image-preview': {
    gemini: 'gemini-2.5-flash-image',
    metis: 'nano-banana'
  }
};

const debugImagePromptsEnabled = () => String(process.env.DEBUG_IMAGE_PROMPTS || '').toLowerCase() === 'true';

function createImageGenerationService({
  httpClient,
  geminiApiKey,
  imageModel = DEFAULT_IMAGE_MODEL,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  imageConfig = null
}) {
  const normalizeProviderName = (value, fallback = 'gemini') => {
    const normalized = String(value || fallback).trim().toLowerCase();
    if (['metis', 'gemini', 'xai'].includes(normalized)) return normalized;
    return fallback;
  };

  const getHostname = (value) => {
    try {
      return new URL(String(value || '')).hostname;
    } catch (_error) {
      return '';
    }
  };

  const defaultBaseUrl = String(imageConfig?.baseUrl || baseUrl || '').replace(/\/+$/, '');
  const defaultProviderName = normalizeProviderName(
    imageConfig?.provider || (/(^|\.)metisai\.ir$/i.test(getHostname(defaultBaseUrl)) ? 'metis' : 'gemini'),
    'gemini'
  );
  const defaultModel = String(imageConfig?.model || imageModel || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL;
  const defaultModelSource = imageConfig?.modelSource || 'default';
  const fallbackKeyInfo = {
    apiKey: typeof (imageConfig?.apiKey || geminiApiKey) === 'string' ? (imageConfig?.apiKey || geminiApiKey).trim() : '',
    apiKeySource: imageConfig?.apiKeySource || (geminiApiKey ? 'legacy GEMINI_API_KEY' : 'missing'),
    apiKeyFingerprint: imageConfig?.apiKeyFingerprint || ''
  };
  const imageKeys = imageConfig?.keys && typeof imageConfig.keys === 'object' ? imageConfig.keys : {};

  const resolveModel = (overrideModel, providerName) => {
    const configuredModel = String(overrideModel || defaultModel || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL;
    const alias = IMAGE_MODEL_ALIASES[configuredModel.toLowerCase()];
    return alias ? alias[providerName] : configuredModel;
  };

  const resolveRuntime = (options = {}) => {
    const providerName = normalizeProviderName(options.provider || imageConfig?.provider || defaultProviderName, defaultProviderName);
    const runtimeBaseUrl = String(options.baseUrl || imageConfig?.baseUrl || defaultBaseUrl).replace(/\/+$/, '');
    const modelAdminValue = String(options.imageModel || imageConfig?.model || defaultModel || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL;
    const modelRuntimeValue = String(options.runtimeModel || options.modelRuntimeValue || '').trim() || resolveModel(modelAdminValue, providerName);
    const modelSource = options.modelSource || imageConfig?.modelSource || defaultModelSource;
    const keyInfo = imageKeys[providerName] || fallbackKeyInfo;
    return {
      providerName,
      baseUrl: runtimeBaseUrl,
      baseUrlHost: getHostname(runtimeBaseUrl),
      modelAdminValue,
      modelRuntimeValue,
      modelSource,
      runtimeProviderName: String(options.runtimeProviderName || options.modelProviderName || '').trim(),
      operation: String(options.operation || 'Imagine').trim() || 'Imagine',
      apiKey: typeof keyInfo?.apiKey === 'string' ? keyInfo.apiKey.trim() : '',
      apiKeySource: keyInfo?.apiKeySource || 'missing',
      apiKeyFingerprint: keyInfo?.apiKeyFingerprint || ''
    };
  };

  const debugLog = (runtime, payload) => {
    if (!debugImagePromptsEnabled()) return;
    console.log('[image-generation][debug]', {
      image: {
        provider: runtime.providerName,
        baseURL: { hostname: runtime.baseUrlHost },
        model: {
          source: runtime.modelSource,
          adminValue: runtime.modelAdminValue,
          runtimeValue: runtime.modelRuntimeValue,
          runtimeProviderName: runtime.runtimeProviderName,
          operation: runtime.operation
        },
        apiKeySource: runtime.apiKeySource,
        apiKeyFingerprint: runtime.apiKeyFingerprint
      },
      ...payload
    });
  };

  const getImageExtension = (mimeType = '') => {
    const normalized = String(mimeType).split(';')[0].trim().toLowerCase();
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
    if (normalized === 'image/webp') return 'webp';
    return 'png';
  };

  const normalizeMimeType = (value) => String(value || '').split(';')[0].trim().toLowerCase();

  const normalizeImageInputs = (value) => {
    const normalized = [...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )];
    if (normalized.length > MAX_IMAGE_EDIT_INPUTS) {
      const error = new Error(`A maximum of ${MAX_IMAGE_EDIT_INPUTS} reference images is supported.`);
      error.code = 'IMAGE_EDIT_TOO_MANY_INPUTS';
      throw error;
    }
    return normalized;
  };

  const getMaxDownloadBytes = (options = {}) => {
    const explicitBytes = Number(options.maxDownloadBytes);
    if (Number.isFinite(explicitBytes) && explicitBytes > 0) return explicitBytes;
    const configuredMb = Number(options.maxDownloadMb || imageConfig?.maxDownloadMb || 10);
    const safeMb = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 10;
    return Math.floor(safeMb * 1024 * 1024);
  };

  const getMetisProvider = (model) => {
    const openaiModels = ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'dall-e-3', 'dall-e-2'];
    const googleModels = ['nano-banana', 'nano-banana-pro', 'nano-banana-2'];
    const blackForestModels = ['flux-pro', 'flux-schnell', 'flux-kontext-max', 'flux-kontext-pro'];
    const qwenModels = ['qwen-image-edit'];
    const nightmareModels = ['real-esrgan', 'remove-bg'];
    const fofrModels = ['face-to-sticker', 'become-image'];
    const normalized = String(model || '').toLowerCase();
    if (openaiModels.includes(normalized)) return 'openai';
    if (googleModels.includes(normalized)) return 'google';
    if (blackForestModels.includes(normalized)) return 'black-forest-labs';
    if (qwenModels.includes(normalized)) return 'qwen';
    if (nightmareModels.includes(normalized)) return 'nightmareai';
    if (fofrModels.includes(normalized)) return 'fofr';
    return 'openai';
  };

  const extractImagePart = (responseData) => {
    const candidates = Array.isArray(responseData?.candidates) ? responseData.candidates : [];
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        const inlineData = part?.inlineData || part?.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
          return {
            base64: inlineData.data,
            mimeType
          };
        }
      }
    }
    return null;
  };

  const getGeminiErrorMessage = (error) => {
    const statusCode = error?.response?.status;
    const responseData = error?.response?.data;
    const apiError = responseData && typeof responseData === 'object' ? responseData.error : null;

    if (statusCode === 402) {
      return PAYMENT_REQUIRED_MESSAGE;
    }

    if (statusCode === 401 || statusCode === 403) {
      return `Gemini API request was rejected (HTTP ${statusCode}). Check GEMINI_API_KEY and Google API access.`;
    }

    if (statusCode === 404) {
      return UNSUPPORTED_MODEL_MESSAGE;
    }

    if (apiError?.message) {
      return apiError.message;
    }

    return error?.message || 'Gemini image generation failed.';
  };

  const getProviderErrorMessage = (error, fallback = 'Image generation failed.') => {
    const statusCode = error?.response?.status;
    const responseData = error?.response?.data;
    const apiError = responseData && typeof responseData === 'object' ? responseData.error : null;
    const message = apiError?.message || apiError || responseData?.message || error?.message || fallback;
    const normalized = String(message || '').toLowerCase();
    if (statusCode === 402 || normalized.includes('payment required')) {
      return PAYMENT_REQUIRED_MESSAGE;
    }
    if (normalized.includes('did not return image data')) {
      return IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE;
    }
    if (
      normalized.includes('maxcontentlength') ||
      normalized.includes('max body length') ||
      normalized.includes('empty image data') ||
      message === IMAGE_STORAGE_FAILED_MESSAGE
    ) {
      return IMAGE_STORAGE_FAILED_MESSAGE;
    }
    if (
      statusCode === 404 ||
      normalized.includes('model') ||
      normalized.includes('not found') ||
      normalized.includes('unsupported') ||
      normalized.includes('not supported')
    ) {
      return UNSUPPORTED_MODEL_MESSAGE;
    }
    return String(message);
  };

  const normalizeImageOptions = (options = {}) => ({
    aspect_ratio: String(options.aspectRatio || options.aspect_ratio || '1:1'),
    resolution: String(options.resolution || '1K'),
    output_format: String(options.outputFormat || options.output_format || 'jpg'),
    safety_filter_level: String(options.safetyFilterLevel || options.safety_filter_level || 'block_only_high')
  });

  const getPollingOptions = (options = {}) => {
    const pollIntervalMs = Number(options.pollIntervalMs || options.poll_interval_ms || 5000);
    const pollTimeoutMs = Number(options.pollTimeoutMs || options.poll_timeout_ms || 90000);
    const safeInterval = Number.isFinite(pollIntervalMs) && pollIntervalMs >= 5000 ? pollIntervalMs : 5000;
    const safeTimeout = Number.isFinite(pollTimeoutMs) && pollTimeoutMs >= 10000 ? pollTimeoutMs : 90000;
    return {
      pollIntervalMs: safeInterval,
      maxAttempts: Math.max(1, Math.ceil(safeTimeout / safeInterval))
    };
  };

  const generateWithMetis = async (prompt, runtime, options = {}) => {
    const model = runtime.modelRuntimeValue;
    if (!runtime.apiKey) {
      const error = new Error(MISSING_IMAGE_API_KEY_MESSAGE);
      error.code = 'MISSING_IMAGE_API_KEY';
      throw error;
    }

    const provider = runtime.runtimeProviderName || getMetisProvider(model);
    if (provider === 'openai' && !['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'dall-e-3', 'dall-e-2'].includes(String(model).toLowerCase())) {
      throw new Error(UNSUPPORTED_MODEL_MESSAGE);
    }
    const imageOptions = normalizeImageOptions(options);
    const rawImageInput = normalizeImageInputs(options.imageInput);
    const createUrl = `${runtime.baseUrl}/api/v2/generate`;
    const headers = {
      Authorization: `Bearer ${runtime.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8'
    };
    const runtimeSettings = {
      runtimeProviderName: provider,
      runtimeModel: model,
      operation: runtime.operation,
      aspectRatio: imageOptions.aspect_ratio,
      resolution: imageOptions.resolution,
      outputFormat: imageOptions.output_format,
      safetyFilterLevel: imageOptions.safety_filter_level,
      customArgs: options.customArgs && typeof options.customArgs === 'object' ? options.customArgs : {},
      editEnabled: Boolean(options.editEnabled)
    };
    const uploadDataUrl = async (dataUrl, index) => {
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return dataUrl;
      const buffer = Buffer.from(match[2], 'base64');
      const mimeType = match[1];
      if (!buffer.length || buffer.length > getMaxDownloadBytes(options)) {
        throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
      }
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
      const form = new FormData();
      form.append('files', buffer, { filename: `danoa-edit-${index + 1}.${extension}`, contentType: mimeType });
      const response = await httpClient.post(`${runtime.baseUrl}/api/v1/storage`, form, {
        headers: { Authorization: `Bearer ${runtime.apiKey}`, ...form.getHeaders() },
        timeout: 120000,
        maxContentLength: getMaxDownloadBytes(options) + 1024 * 1024,
        maxBodyLength: getMaxDownloadBytes(options) + 1024 * 1024
      });
      const uploadedUrl = response?.data?.files?.[0]?.url;
      if (!uploadedUrl) throw new Error('Image provider upload did not return a file URL.');
      return String(uploadedUrl);
    };
    const imageInput = [];
    for (let index = 0; index < rawImageInput.length; index += 1) {
      imageInput.push(await uploadDataUrl(rawImageInput[index], index));
    }
    const body = buildMetisRequestBody({ prompt, runtimeSettings, imageInput });

    console.log('[image-generation] Metis request started', {
      model,
      provider,
      modelSource: runtime.modelSource,
      modelAdminValue: runtime.modelAdminValue,
      runtimeProviderName: provider,
      runtimeModel: model,
      operation: runtime.operation,
      resolution: imageOptions.resolution,
      aspectRatio: imageOptions.aspect_ratio,
      outputFormat: imageOptions.output_format,
      promptLength: prompt.length,
      hasImageInput: imageInput.length > 0,
      imageInputCount: imageInput.length,
      apiKeySource: runtime.apiKeySource,
      hasApiKey: Boolean(runtime.apiKey)
    });

    let phase = 'create';
    try {
      const createResponse = await httpClient.post(createUrl, body, { headers, timeout: 120000 });
      const taskId = createResponse?.data?.id;
      if (!taskId) {
        throw new Error('Image provider did not return a task id.');
      }
      debugLog(runtime, {
        originalUserMessage: options.originalPrompt || prompt,
        finalImagePrompt: prompt,
        resolution: imageOptions.resolution,
        aspect_ratio: imageOptions.aspect_ratio,
        output_format: imageOptions.output_format,
        safetyFilterLevel: imageOptions.safety_filter_level,
        taskId: options.taskId || taskId,
        status: 'QUEUE'
      });

      phase = 'poll';
      let statusPayload = null;
      const { pollIntervalMs, maxAttempts } = getPollingOptions(options);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const statusResponse = await httpClient.get(`${runtime.baseUrl}/api/v2/generate/${encodeURIComponent(taskId)}`, {
          headers,
          timeout: 30000
        });
        statusPayload = statusResponse?.data || null;
        const status = String(statusPayload?.status || '').toUpperCase();
        debugLog(runtime, {
          originalUserMessage: options.originalPrompt || prompt,
          finalImagePrompt: prompt,
          resolution: imageOptions.resolution,
          aspect_ratio: imageOptions.aspect_ratio,
          output_format: imageOptions.output_format,
          safetyFilterLevel: imageOptions.safety_filter_level,
          taskId: options.taskId || taskId,
          status
        });
        if (status === 'COMPLETED') break;
        if (status === 'ERROR' || status === 'FAILED') {
          throw new Error(statusPayload?.error || 'Image provider task failed.');
        }
      }

      const imageUrl = statusPayload?.generations?.[0]?.url || statusPayload?.generations?.[0]?.content || null;
      if (!imageUrl) {
        throw new Error(IMAGE_PROVIDER_EMPTY_RESULT_MESSAGE);
      }

      const maxDownloadBytes = getMaxDownloadBytes(options);
      const remoteImageUrlHost = getHostname(imageUrl);
      phase = 'download';
      const imageResponse = await httpClient.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: maxDownloadBytes,
        maxBodyLength: maxDownloadBytes
      });
      const mimeType = normalizeMimeType(imageResponse?.headers?.['content-type'] || 'image/png');
      const contentLength = Number(imageResponse?.headers?.['content-length'] || 0);
      if (contentLength > maxDownloadBytes || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
      }
      const buffer = Buffer.from(imageResponse?.data || []);
      if (!buffer.length || buffer.length > maxDownloadBytes) {
        throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
      }
      phase = 'complete';

      console.log('[image-generation] Metis request succeeded', {
        model,
        provider,
        resolution: imageOptions.resolution,
        aspectRatio: imageOptions.aspect_ratio,
        outputFormat: imageOptions.output_format,
        mimeType,
        bytes: buffer.length
      });
      debugLog(runtime, {
        originalUserMessage: options.originalPrompt || prompt,
        finalImagePrompt: prompt,
        resolution: imageOptions.resolution,
        aspect_ratio: imageOptions.aspect_ratio,
        output_format: imageOptions.output_format,
        safetyFilterLevel: imageOptions.safety_filter_level,
        metisTaskId: taskId,
        localTaskId: options.taskId || null,
        remoteImageUrlHost,
        downloadStatus: 'downloaded',
        mimeType,
        fileSize: buffer.length,
        status: 'COMPLETED'
      });

      return {
        buffer,
        mimeType,
        extension: getImageExtension(mimeType),
        model,
        provider: 'Metis',
        modelSource: runtime.modelSource,
        modelAdminValue: runtime.modelAdminValue,
        modelRuntimeValue: model,
        metisTaskId: taskId,
        remoteImageUrl: imageUrl,
        remoteImageUrlHost
      };
    } catch (error) {
      const message = phase === 'download'
        ? IMAGE_STORAGE_FAILED_MESSAGE
        : getProviderErrorMessage(error, 'Metis image generation failed.');
      console.error('[image-generation] Metis request failed', {
        message,
        statusCode: error?.response?.status || null,
        model,
        provider,
        modelSource: runtime.modelSource,
        modelAdminValue: runtime.modelAdminValue,
        runtimeProviderName: provider,
        runtimeModel: model
      });
      debugLog(runtime, {
        originalUserMessage: options.originalPrompt || prompt,
        finalImagePrompt: prompt,
        resolution: imageOptions.resolution,
        aspect_ratio: imageOptions.aspect_ratio,
        output_format: imageOptions.output_format,
        safetyFilterLevel: imageOptions.safety_filter_level,
        taskId: options.taskId || null,
        status: 'ERROR',
        errorMessage: message
      });
      throw new Error(message);
    }
  };

  const generateWithGemini = async (prompt, runtime, options = {}) => {
    const model = runtime.modelRuntimeValue;
    if (!runtime.apiKey) {
      const error = new Error(MISSING_IMAGE_API_KEY_MESSAGE);
      error.code = 'MISSING_GEMINI_API_KEY';
      throw error;
    }

    const url = `${runtime.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const imageInputs = normalizeImageInputs(options.imageInput);
    const imageParts = [];
    for (const input of imageInputs) {
      const dataMatch = input.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (dataMatch) {
        imageParts.push({ inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } });
        continue;
      }
      if (/^https?:\/\//i.test(input)) {
        const maxDownloadBytes = getMaxDownloadBytes(options);
        const response = await httpClient.get(input, {
          responseType: 'arraybuffer',
          timeout: 120000,
          maxContentLength: maxDownloadBytes,
          maxBodyLength: maxDownloadBytes
        });
        const mimeType = normalizeMimeType(response?.headers?.['content-type']);
        const buffer = Buffer.from(response?.data || []);
        if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType) || !buffer.length || buffer.length > maxDownloadBytes) {
          throw new Error(IMAGE_STORAGE_FAILED_MESSAGE);
        }
        imageParts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
      }
    }
    const body = {
      contents: [
        {
          role: 'user',
          parts: [...imageParts, { text: prompt }]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    };

    console.log('[image-generation] Gemini request started', {
      model,
      modelSource: runtime.modelSource,
      modelAdminValue: runtime.modelAdminValue,
      promptLength: prompt.length,
      imageInputCount: imageInputs.length,
      apiKeySource: runtime.apiKeySource,
      hasApiKey: Boolean(runtime.apiKey)
    });
    debugLog(runtime, {
      originalUserMessage: options.originalPrompt || prompt,
      finalImagePrompt: prompt,
      resolution: options.resolution || '1K',
      aspect_ratio: options.aspectRatio || options.aspect_ratio || '1:1',
      output_format: options.outputFormat || options.output_format || 'jpg',
      safetyFilterLevel: options.safetyFilterLevel || options.safety_filter_level || 'block_only_high',
      taskId: options.taskId || null,
      status: 'RUNNING'
    });

    try {
      const response = await httpClient.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': runtime.apiKey
        },
        timeout: 120000
      });

      const imagePart = extractImagePart(response?.data);
      if (!imagePart) {
        const finishReason = response?.data?.candidates?.[0]?.finishReason;
        throw new Error(`Gemini did not return image data${finishReason ? ` (finishReason: ${finishReason})` : ''}.`);
      }

      const buffer = Buffer.from(imagePart.base64, 'base64');
      if (!buffer.length) {
        throw new Error('Gemini returned empty image data.');
      }

      console.log('[image-generation] Gemini request succeeded', {
        model,
        mimeType: imagePart.mimeType,
        bytes: buffer.length
      });

      return {
        buffer,
        mimeType: imagePart.mimeType,
        extension: getImageExtension(imagePart.mimeType),
        model,
        provider: 'Gemini',
        modelSource: runtime.modelSource,
        modelAdminValue: runtime.modelAdminValue,
        modelRuntimeValue: model
      };
    } catch (error) {
      const statusCode = error?.response?.status;
      const responseData = error?.response?.data;
      const apiError = responseData && typeof responseData === 'object' ? responseData.error : null;
      const message = getGeminiErrorMessage(error);
      console.error('[image-generation] Gemini request failed', {
        message,
        statusCode,
        reason: apiError?.status || apiError?.code || null,
        model,
        modelSource: runtime.modelSource,
        modelAdminValue: runtime.modelAdminValue
      });
      debugLog(runtime, {
        originalUserMessage: options.originalPrompt || prompt,
        finalImagePrompt: prompt,
        resolution: options.resolution || '1K',
        aspect_ratio: options.aspectRatio || options.aspect_ratio || '1:1',
        output_format: options.outputFormat || options.output_format || 'jpg',
        safetyFilterLevel: options.safetyFilterLevel || options.safety_filter_level || 'block_only_high',
        taskId: options.taskId || null,
        status: 'ERROR',
        errorMessage: message
      });
      throw new Error(message);
    }
  };

  const generateImage = async (prompt, options = {}) => {
    const runtime = resolveRuntime(options);
    if (runtime.providerName === 'metis') {
      return generateWithMetis(prompt, runtime, options);
    }
    if (runtime.providerName === 'gemini') {
      return generateWithGemini(prompt, runtime, options);
    }
    throw new Error(UNSUPPORTED_MODEL_MESSAGE);
  };

  return {
    generateImage,
    supportsImageEdit: (options = {}) => {
      const model = String(options.runtimeModel || options.imageModel || '').trim().toLowerCase();
      if (!model) return true;
      return ['nano-banana', 'nano-banana-pro', 'nano-banana-2', 'gemini-2.5-flash-image', 'gemini-3-pro-image'].includes(model);
    }
  };
}

module.exports = { createImageGenerationService };
