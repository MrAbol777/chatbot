/**
 * Image generation service — calls the official Google Gemini API.
 *
 * The public app contract remains async/polled at our API boundary, but Gemini
 * image generation itself is a single generateContent request handled by the
 * controller's background worker.
 */
const REQUIRED_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

function createImageGenerationService({
  httpClient,
  geminiApiKey,
  imageModel = REQUIRED_GEMINI_IMAGE_MODEL,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
}) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedModel = String(imageModel || REQUIRED_GEMINI_IMAGE_MODEL).trim();

  const getImageExtension = (mimeType = '') => {
    const normalized = String(mimeType).toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    return 'png';
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

    if (apiError?.message) {
      return apiError.message;
    }

    if (statusCode === 401 || statusCode === 403) {
      return `Gemini API request was rejected (HTTP ${statusCode}). Check GEMINI_API_KEY and Google API access for ${REQUIRED_GEMINI_IMAGE_MODEL}.`;
    }

    if (statusCode === 404) {
      return `Gemini image model was not found. GEMINI_IMAGE_MODEL must be ${REQUIRED_GEMINI_IMAGE_MODEL}.`;
    }

    return error?.message || 'Gemini image generation failed.';
  };

  const generateImage = async (prompt) => {
    if (!geminiApiKey) {
      const error = new Error('GEMINI_API_KEY is missing');
      error.code = 'MISSING_GEMINI_API_KEY';
      throw error;
    }

    if (normalizedModel !== REQUIRED_GEMINI_IMAGE_MODEL) {
      throw new Error(`GEMINI_IMAGE_MODEL must be ${REQUIRED_GEMINI_IMAGE_MODEL}.`);
    }

    const url = `${normalizedBaseUrl}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
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
      model: normalizedModel,
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
        model: normalizedModel,
        mimeType: imagePart.mimeType,
        bytes: buffer.length
      });

      return {
        buffer,
        mimeType: imagePart.mimeType,
        extension: getImageExtension(imagePart.mimeType),
        model: normalizedModel
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
        model: normalizedModel
      });
      throw new Error(message);
    }
  };

  return {
    generateImage
  };
}

module.exports = { createImageGenerationService };
