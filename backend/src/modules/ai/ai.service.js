const normalizeHistory = (history, currentMessage) => {
  const clean = Array.isArray(history)
    ? history
        .filter(
          (item) =>
            item &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0
        )
        .map((item) => ({ role: item.role, content: item.content.trim() }))
    : [];

  while (clean.length > 0 && clean[0].role !== 'user') {
    clean.shift();
  }

  if (
    clean.length === 0 ||
    clean[clean.length - 1].role !== 'user' ||
    clean[clean.length - 1].content !== currentMessage
  ) {
    clean.push({ role: 'user', content: currentMessage });
  }

  return clean;
};

const isValidChatContentPart = (part) => {
  if (!part || typeof part !== 'object') {
    return false;
  }

  if (part.type === 'text') {
    return typeof part.text === 'string' && part.text.trim().length > 0;
  }

  if (part.type === 'image_url') {
    return typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:image/');
  }

  return false;
};

const buildChatMessages = (messages) =>
  (Array.isArray(messages) ? messages : [])
    .filter(
      (item) =>
        item &&
        (item.role === 'system' || item.role === 'user' || item.role === 'assistant') &&
        ((typeof item.content === 'string' && item.content.trim().length > 0) ||
          (item.role === 'user' && Array.isArray(item.content) && item.content.some(isValidChatContentPart)))
    )
    .map((item) => ({
      role: item.role,
      content:
        typeof item.content === 'string'
          ? item.content.trim()
          : item.content.filter(isValidChatContentPart).map((part) =>
              part.type === 'text' ? { type: 'text', text: part.text.trim() } : part
            )
    }));

const extractReply = (response) => {
  // Gemini format: candidates[0].content.parts[0].text
  if (Array.isArray(response?.candidates)) {
    const text = response.candidates[0]?.content?.parts?.[0]?.text;
    if (typeof text === 'string') {
      return text.trim();
    }
  }

  // OpenAI format: choices[0].message.content
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
};

const removeExtraGreeting = (text, isFirstMessage) => {
  if (typeof text !== 'string') return '';
  if (isFirstMessage) return text;

  const cleaned = text.trimStart();
  const greetingPattern =
    /^(?:(?:سلام(?:\s+(?:دوباره|مجدد))?)|درود|(?:من\s+دانوآ\s+هستم)|(?:من\s+دانوآم))(?:[\s،,:!.\-—]+|$)/i;

  return cleaned.replace(greetingPattern, '').trimStart();
};

const detectCategory = (msg) => {
  const lower = typeof msg === 'string' ? msg.toLowerCase() : '';
  if (/ریاضی|علم|فرمول|معادله|چرا|چگونه|درس|مدرسه|فیزیک|شیمی|زیست/.test(lower)) return 'academic';
  if (/احساس|ناراحت|غمگین|ترس|استرس|خجالت|دعوا|دوست|رابطه|دوستی|مامان|بابا/.test(lower)) return 'emotional';
  if (/داستان|قصه|ایده|شخصیت|بنویس|نوشتن|خلاقیت|ماجراجویی/.test(lower)) return 'creative';
  return 'general';
};

const imageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeImageIds = (imageIds) => {
  if (!Array.isArray(imageIds)) {
    return [];
  }

  const seen = new Set();
  const clean = [];
  for (const item of imageIds) {
    if (typeof item !== 'string') {
      continue;
    }
    const value = item.trim();
    if (!value || !imageIdPattern.test(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    clean.push(value);
    if (clean.length >= 5) {
      break;
    }
  }
  return clean;
};

const buildImageContentParts = (message, images) => {
  const text =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : 'این عکس را با زبان ساده توصیف کن و اگر سوال، نوشته، تمرین یا نکته‌ای در تصویر هست، به همان پاسخ بده.';

  return [
    { type: 'text', text },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
        detail: 'auto'
      }
    }))
  ];
};

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error('UPSTREAM_TIMEOUT');
          timeoutError.code = 'UPSTREAM_TIMEOUT';
          reject(timeoutError);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

function createAiService({
  apiKey,
  baseUrl,
  openaiClient,
  httpClient,
  promptService,
  conversationStore = new Map(),
  usersRepository,
  conversationsRepository,
  eventsRepository,
  uploadedImagesRepository = null,
  logger = console
}) {
  const log = (scope, message, meta) => {
    if (typeof logger.log === 'function') {
      logger.log(scope, message, meta);
    }
  };

  const isGeminiModel = (modelName) =>
    typeof modelName === 'string' && modelName.toLowerCase().includes('gemini');

  // ─── Gemini (Metis wrapper) helpers ──────────────────────────────
  const buildGeminiPayload = (messages) => {
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const contents = chatMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: typeof msg.content === 'string'
            ? msg.content
            : msg.content?.find((p) => p.type === 'text')?.text || ''
        }
      ]
    }));

    const payload = { contents };

    if (systemMessage && typeof systemMessage.content === 'string') {
      payload.systemInstruction = {
        parts: [{ text: systemMessage.content }]
      };
    }

    return payload;
  };

  const callGemini = async (messages, timeoutMs, requestId) => {
    if (!apiKey) {
      const error = new Error('METIS_API_KEY is missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    const runtimeConfig = await promptService.getRuntimeConfig();
    const geminiModel = runtimeConfig.model || 'gemini-2.5-flash';
    const geminiEndpoint = `https://api.metisai.ir/v1beta/models/${geminiModel}:generateContent`;
    const payload = buildGeminiPayload(messages);

    try {
      log('GEMINI', 'request_started', { requestId, timeoutMs, model: geminiModel, endpoint: geminiEndpoint });

      const response = await httpClient.post(
        geminiEndpoint,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          timeout: timeoutMs
        }
      );

      const reply = extractReply(response?.data);

      if (!reply) {
        const error = new Error('EMPTY_UPSTREAM_REPLY');
        error.code = 'EMPTY_UPSTREAM_REPLY';
        error.details = response?.data;
        throw error;
      }

      log('GEMINI', 'request_succeeded', { requestId, replyLength: reply.length });
      return reply;
    } catch (error) {
      log('GEMINI', 'request_failed', {
        requestId,
        code: error?.code || null,
        status: Number(error?.response?.status) || null,
        message: error instanceof Error ? error.message : String(error || '')
      });

      if (error && typeof error === 'object' && error.code === 'ECONNABORTED') {
        const timeoutError = new Error('UPSTREAM_TIMEOUT');
        timeoutError.code = 'UPSTREAM_TIMEOUT';
        throw timeoutError;
      }

      const status = Number(error?.response?.status);
      const details = error?.response?.data || (error instanceof Error ? error.message : 'unknown');

      if (!Number.isInteger(status)) {
        const networkError = new Error('UPSTREAM_FETCH_FAILED');
        networkError.code = 'UPSTREAM_FETCH_FAILED';
        networkError.details = { cause: details };
        throw networkError;
      }

      const upstreamError = new Error('UPSTREAM_REQUEST_FAILED');
      upstreamError.code = 'UPSTREAM_REQUEST_FAILED';
      upstreamError.details = { status, details };
      throw upstreamError;
    }
  };

  const postOpenAIChatCompletion = async (payload, timeoutMs) => {
    const response = await httpClient.post(`${baseUrl}/chat/completions`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      timeout: timeoutMs
    });

    return response.data;
  };

  const callOpenAI = async (messages, context = {}) => {
    if (!apiKey) {
      const error = new Error('METIS_API_KEY is missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    const runtimeConfig = await promptService.getRuntimeConfig();
    const payload = {
      model: runtimeConfig.model,
      messages: buildChatMessages(messages),
      temperature: 0.6
    };
    const totalTimeoutMs = Math.max(5000, runtimeConfig.timeoutMs);
    const sdkTimeoutMs = Math.min(8000, totalTimeoutMs);
    const fallbackTimeoutMs = Math.max(5000, totalTimeoutMs - sdkTimeoutMs);
    const requestId = context.requestId || 'unknown';

    // Route Gemini models to the Metis Gemini wrapper
    if (isGeminiModel(runtimeConfig.model)) {
      log('CHAT', 'model_routed', { requestId, model: runtimeConfig.model, engine: 'gemini' });
      return callGemini(messages, totalTimeoutMs, requestId);
    }

    try {
      let response = null;

      try {
        log('OPENAI', 'sdk_attempt_started', {
          requestId,
          model: runtimeConfig.model,
          sdkTimeoutMs
        });
        response = await withTimeout(
          openaiClient.chat.completions.create(payload, {
            timeout: sdkTimeoutMs,
            maxRetries: 0
          }),
          sdkTimeoutMs
        );
        log('OPENAI', 'sdk_attempt_succeeded', { requestId });
      } catch (sdkError) {
        log('OPENAI', 'sdk_attempt_failed', {
          requestId,
          code: sdkError?.code || null,
          name: sdkError?.name || null,
          message: sdkError instanceof Error ? sdkError.message : String(sdkError || '')
        });
        const shouldFallback =
          sdkError &&
          typeof sdkError === 'object' &&
          (sdkError.code === 'UPSTREAM_TIMEOUT' ||
            sdkError.name === 'APIConnectionError' ||
            sdkError.name === 'APIConnectionTimeoutError' ||
            sdkError.name === 'InternalServerError');

        if (!shouldFallback) {
          throw sdkError;
        }

        log('OPENAI', 'fallback_http_started', {
          requestId,
          fallbackTimeoutMs
        });
        response = await postOpenAIChatCompletion(payload, fallbackTimeoutMs);
        log('OPENAI', 'fallback_http_succeeded', { requestId });
      }

      const reply = extractReply(response);

      if (!reply) {
        const error = new Error('EMPTY_UPSTREAM_REPLY');
        error.code = 'EMPTY_UPSTREAM_REPLY';
        error.details = response;
        throw error;
      }

      return reply;
    } catch (error) {
      log('OPENAI', 'final_failure', {
        requestId,
        code: error?.code || null,
        name: error?.name || null,
        status: Number(error?.status || error?.cause?.status || error?.response?.status) || null,
        message: error instanceof Error ? error.message : String(error || ''),
        baseUrl
      });
      if (error && typeof error === 'object' && error.code === 'UPSTREAM_TIMEOUT') {
        throw error;
      }

      const status = Number(error?.status || error?.cause?.status || error?.response?.status);
      const details =
        error?.error ||
        error?.response?.data ||
        error?.cause ||
        (error instanceof Error ? error.message : 'unknown_error');

      if (error && typeof error === 'object' && error.code === 'ECONNABORTED') {
        const timeoutError = new Error('UPSTREAM_TIMEOUT');
        timeoutError.code = 'UPSTREAM_TIMEOUT';
        throw timeoutError;
      }

      if (!Number.isInteger(status)) {
        const networkError = new Error('UPSTREAM_FETCH_FAILED');
        networkError.code = 'UPSTREAM_FETCH_FAILED';
        networkError.details = {
          baseUrl,
          cause: details
        };
        throw networkError;
      }

      const upstreamError = new Error('UPSTREAM_REQUEST_FAILED');
      upstreamError.code = 'UPSTREAM_REQUEST_FAILED';
      upstreamError.details = {
        status,
        details
      };
      throw upstreamError;
    }
  };

  const sendChatMessage = async ({ message, profile, history, conversationId, imageIds, requestId }) => {
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';
    const rawImageIds = Array.isArray(imageIds) ? imageIds : [];
    const normalizedImageIds = normalizeImageIds(imageIds);
    const hasImages = normalizedImageIds.length > 0;

    log('CHAT', 'incoming_message', {
      requestId,
      hasProfile: Boolean(profile),
      historyCount: Array.isArray(history) ? history.length : 0,
      messageLength: trimmedMessage.length,
      imageCount: normalizedImageIds.length
    });

    if (!apiKey) {
      const error = new Error('METIS_API_KEY is missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    if (!trimmedMessage && !hasImages) {
      const error = new Error('INVALID_MESSAGE');
      error.code = 'INVALID_MESSAGE';
      throw error;
    }

    if (
      rawImageIds.some((item) => typeof item !== 'string' || !imageIdPattern.test(item.trim()))
    ) {
      const error = new Error('INVALID_IMAGE');
      error.code = 'INVALID_IMAGE';
      throw error;
    }

    if (hasImages && !uploadedImagesRepository) {
      const error = new Error('INVALID_IMAGE');
      error.code = 'INVALID_IMAGE';
      throw error;
    }

    const resolvedImages = hasImages ? await uploadedImagesRepository.getByIds(normalizedImageIds) : [];
    if (resolvedImages.length !== normalizedImageIds.length) {
      const error = new Error('IMAGE_NOT_FOUND');
      error.code = 'IMAGE_NOT_FOUND';
      error.details = {
        requested: normalizedImageIds.length,
        found: resolvedImages.length
      };
      throw error;
    }

    const userId = await usersRepository.ensureUserExists(profile || {});
    const messageForHistory = trimmedMessage || '📷 عکس ارسال شد';
    const category = detectCategory(messageForHistory);
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';
    const memoryKey = `${userId}:${normalizedConversationId}`;

    await eventsRepository.logEvent(userId, 'message_sent', category, {
      messageLength: messageForHistory.length,
      imageCount: normalizedImageIds.length,
      requestId
    });

    const normalizedHistory = normalizeHistory(history, messageForHistory);
    const storedHistory = conversationStore.get(memoryKey);
    const dbHistory = await conversationsRepository.getConversationMessages(userId, normalizedConversationId);
    let effectiveHistory =
      Array.isArray(storedHistory) && storedHistory.length > normalizedHistory.length ? [...storedHistory] : normalizedHistory;
    if (dbHistory.length > effectiveHistory.length) {
      effectiveHistory = [...dbHistory];
    }
    const lastItem = effectiveHistory[effectiveHistory.length - 1];
    if (!lastItem || lastItem.role !== 'user' || lastItem.content !== messageForHistory) {
      effectiveHistory.push({ role: 'user', content: messageForHistory });
    }
    if (normalizedHistory.length > 50) {
      log('CHAT', 'long_conversation_warning', {
        requestId,
        historyCount: effectiveHistory.length,
        warning: 'مکالمه طولانی شده، ممکن است پاسخ ها کیفیت کمتری داشته باشند'
      });
    }

    const systemPrompt = await promptService.getSystemPrompt();
    const modelHistory = [...effectiveHistory];
    if (resolvedImages.length > 0) {
      const lastUserIndex = modelHistory.findLastIndex((item) => item.role === 'user');
      if (lastUserIndex >= 0) {
        modelHistory[lastUserIndex] = {
          ...modelHistory[lastUserIndex],
          content: buildImageContentParts(trimmedMessage, resolvedImages)
        };
      }
    }

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...modelHistory
    ];

    const isFirstMessage = normalizedHistory.length === 1;
    const rawReply = await callOpenAI(messages, { requestId });
    const reply = removeExtraGreeting(rawReply, isFirstMessage);
    const nextConversationMessages = [...effectiveHistory, { role: 'assistant', content: reply }];
    conversationStore.set(memoryKey, nextConversationMessages);
    await conversationsRepository.saveConversationMessages(userId, normalizedConversationId, nextConversationMessages);

    await eventsRepository.logEvent(userId, 'message_received', category, {
      responseLength: reply.length,
      requestId
    });

    return { reply };
  };

  return {
    sendChatMessage,
    callOpenAI
  };
}

module.exports = { createAiService };
