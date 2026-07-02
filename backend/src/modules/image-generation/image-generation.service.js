/**
 * Image generation service — calls Google Gemini or Metis image APIs.
 *
 * The public app contract remains async/polled at our API boundary, but Gemini
 * image generation itself is a single generateContent request handled by the
 * controller's background worker.
 */
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

function createImageGenerationService({
  httpClient,
  geminiApiKey,
  imageModel = DEFAULT_IMAGE_MODEL,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
}) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const defaultModel = String(imageModel || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL;
  const isMetisProvider = /(^|\.)metisai\.ir$/i.test(new URL(normalizedBaseUrl).hostname);

  const resolveModel = (overrideModel) => String(overrideModel || defaultModel || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL;

  const getImageExtension = (mimeType = '') => {
    const normalized = String(mimeType).toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    return 'png';
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

    if (statusCode === 401 || statusCode === 403) {
      return `Gemini API request was rejected (HTTP ${statusCode}). Check GEMINI_API_KEY and Google API access.`;
    }

    if (statusCode === 404) {
      return 'مدل ساخت تصویر توسط سرویس‌دهنده پشتیبانی نمی‌شود';
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
    if (
      statusCode === 404 ||
      normalized.includes('model') ||
      normalized.includes('not found') ||
      normalized.includes('unsupported') ||
      normalized.includes('not supported')
    ) {
      return 'مدل ساخت تصویر توسط سرویس‌دهنده پشتیبانی نمی‌شود';
    }
    return String(message);
  };

  const generateWithMetis = async (prompt, model) => {
    if (!geminiApiKey) {
      const error = new Error('Image provider API key is missing');
      error.code = 'MISSING_IMAGE_API_KEY';
      throw error;
    }

    const provider = getMetisProvider(model);
    const createUrl = `${normalizedBaseUrl}/api/v2/generate`;
    const headers = {
      Authorization: `Bearer ${geminiApiKey}`,
      'Content-Type': 'application/json; charset=utf-8'
    };
    const body = {
      model: { name: provider, model },
      operation: 'Imagine',
      args: { prompt }
    };

    console.log('[image-generation] Metis request started', {
      model,
      provider,
      promptLength: prompt.length,
      hasApiKey: Boolean(geminiApiKey)
    });

    try {
      const createResponse = await httpClient.post(createUrl, body, { headers, timeout: 120000 });
      const taskId = createResponse?.data?.id;
      if (!taskId) {
        throw new Error('Image provider did not return a task id.');
      }

      let statusPayload = null;
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const statusResponse = await httpClient.get(`${normalizedBaseUrl}/api/v2/generate/${encodeURIComponent(taskId)}`, {
          headers,
          timeout: 30000
        });
        statusPayload = statusResponse?.data || null;
        const status = String(statusPayload?.status || '').toUpperCase();
        if (status === 'COMPLETED') break;
        if (status === 'ERROR' || status === 'FAILED') {
          throw new Error(statusPayload?.error || 'Image provider task failed.');
        }
      }

      const imageUrl = statusPayload?.generations?.[0]?.url || statusPayload?.generations?.[0]?.content || null;
      if (!imageUrl) {
        throw new Error('Image provider did not return image data.');
      }

      const imageResponse = await httpClient.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 120000
      });
      const mimeType = imageResponse?.headers?.['content-type'] || 'image/png';
      const buffer = Buffer.from(imageResponse?.data || []);
      if (!buffer.length) {
        throw new Error('Image provider returned empty image data.');
      }

      console.log('[image-generation] Metis request succeeded', {
        model,
        provider,
        mimeType,
        bytes: buffer.length
      });

      return {
        buffer,
        mimeType,
        extension: getImageExtension(mimeType),
        model
      };
    } catch (error) {
      const message = getProviderErrorMessage(error, 'Metis image generation failed.');
      console.error('[image-generation] Metis request failed', {
        message,
        statusCode: error?.response?.status || null,
        model,
        provider
      });
      throw new Error(message);
    }
  };

  const generateWithGemini = async (prompt, model) => {
    if (!geminiApiKey) {
      const error = new Error('GEMINI_API_KEY is missing');
      error.code = 'MISSING_GEMINI_API_KEY';
      throw error;
    }

    const url = `${normalizedBaseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    };

    console.log('[image-generation] Gemini request started', {
      model,
      promptLength: prompt.length,
      hasApiKey: Boolean(geminiApiKey)
    });

    try {
      const response = await httpClient.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey
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
        model
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
        model
      });
      throw new Error(message);
    }
  };

  const generateImage = async (prompt, options = {}) => {
    const model = resolveModel(options.imageModel);
    if (isMetisProvider) {
      return generateWithMetis(prompt, model);
    }
    return generateWithGemini(prompt, model);
  };

  return {
    generateImage,
    supportsImageEdit: () => false
  };
}

module.exports = { createImageGenerationService };
