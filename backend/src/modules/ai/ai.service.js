const { streamOpenAIChat, streamGeminiContent } = require('./provider-stream');

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

const extractTokenUsage = (response) => {
  if (response?.usage && typeof response.usage === 'object') {
    return response.usage;
  }

  if (response?.usageMetadata && typeof response.usageMetadata === 'object') {
    return response.usageMetadata;
  }

  return null;
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

const makeMessageId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

const parseDataImageUrl = (url) => {
  if (typeof url !== 'string') {
    return null;
  }

  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    data: match[2].replace(/\s+/g, '')
  };
};

const buildGeminiParts = (content) => {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  if (!Array.isArray(content)) {
    return [{ text: '' }];
  }

  const parts = [];
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      parts.push({ text: part.text.trim() });
      continue;
    }

    if (part?.type === 'image_url') {
      const imageData = parseDataImageUrl(part.image_url?.url);
      if (imageData) {
        parts.push({
          inline_data: {
            mime_type: imageData.mimeType,
            data: imageData.data
          }
        });
      }
    }
  }

  return parts.length > 0 ? parts : [{ text: '' }];
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
  settingsRepository,
  usersRepository,
  conversationsRepository,
  eventsRepository,
  chatMessagesRepository,
  conversationContextBuilder = null,
  conversationMemoryService = null,
  conversationMemoryWriterService = null,
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

  const getChatSettings = async () => {
    const runtimeConfig = await promptService.getRuntimeConfig();
    if (!settingsRepository || typeof settingsRepository.getAll !== 'function') {
      return {
        model: runtimeConfig.model || 'gemini-2.5-flash',
        timeoutMs: runtimeConfig.timeoutMs,
        temperature: 0.6
      };
    }

    const settings = await settingsRepository.getAll();
    return {
      model: typeof settings['ai.chat.model'] === 'string' && settings['ai.chat.model'].trim()
        ? settings['ai.chat.model'].trim()
        : runtimeConfig.model || 'gemini-2.5-flash',
      timeoutMs: Number.isFinite(Number(settings['ai.chat.timeout_ms']))
        ? Number(settings['ai.chat.timeout_ms'])
        : runtimeConfig.timeoutMs,
      temperature: Number.isFinite(Number(settings['ai.chat.temperature']))
        ? Number(settings['ai.chat.temperature'])
        : 0.6
    };
  };

  // ─── Gemini (Metis wrapper) helpers ──────────────────────────────
  const buildGeminiPayload = (messages) => {
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const contents = chatMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: buildGeminiParts(msg.content)
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

    const runtimeConfig = await getChatSettings();
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
      return {
        reply,
        model: geminiModel,
        tokenUsage: extractTokenUsage(response?.data)
      };
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

    const runtimeConfig = await getChatSettings();
    const payload = {
      model: runtimeConfig.model,
      messages: buildChatMessages(messages),
      temperature: runtimeConfig.temperature
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

      return {
        reply,
        model: runtimeConfig.model,
        tokenUsage: extractTokenUsage(response)
      };
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

  const callOpenAIStream = async (messages, { requestId = 'unknown', signal, onDelta } = {}) => {
    if (!apiKey) throw Object.assign(new Error('METIS_API_KEY is missing'), { code: 'API_KEY_MISSING' });
    const runtimeConfig = await getChatSettings();
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), Math.max(5000, runtimeConfig.timeoutMs));
    const abortFromParent = () => timeoutController.abort();
    signal?.addEventListener('abort', abortFromParent, { once: true });
    try {
      if (isGeminiModel(runtimeConfig.model)) {
        const result = await streamGeminiContent({
          endpoint: `https://api.metisai.ir/v1beta/models/${encodeURIComponent(runtimeConfig.model)}:streamGenerateContent`,
          apiKey,
          payload: buildGeminiPayload(messages),
          signal: timeoutController.signal,
          onDelta
        });
        return { model: runtimeConfig.model, tokenUsage: result.tokenUsage };
      }
      const result = await streamOpenAIChat({
        endpoint: `${baseUrl}/chat/completions`,
        apiKey,
        payload: { model: runtimeConfig.model, messages: buildChatMessages(messages), temperature: runtimeConfig.temperature },
        signal: timeoutController.signal,
        onDelta
      });
      return { model: runtimeConfig.model, tokenUsage: result.tokenUsage };
    } catch (error) {
      if (timeoutController.signal.aborted && !signal?.aborted) {
        throw Object.assign(new Error('UPSTREAM_TIMEOUT'), { code: 'UPSTREAM_TIMEOUT' });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortFromParent);
    }
  };

  const sendChatMessage = async ({ message, profile, history, conversationId, imageIds, requestId, limitStatus = null }) => {
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';
    const userMessageCreatedAt = new Date();
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
    let normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0
        ? conversationId.trim()
        : conversationMemoryService && typeof conversationMemoryService.generateConversationId === 'function'
          ? conversationMemoryService.generateConversationId()
          : 'default';
    if (
      conversationMemoryService &&
      typeof conversationMemoryService.isValidConversationId === 'function' &&
      !conversationMemoryService.isValidConversationId(normalizedConversationId)
    ) {
      normalizedConversationId = conversationMemoryService.generateConversationId();
    }
    const memoryKey = `${userId}:${normalizedConversationId}`;

    if (conversationsRepository && typeof conversationsRepository.ensureConversation === 'function') {
      await conversationsRepository.ensureConversation(userId, normalizedConversationId);
    }

    await eventsRepository.logEvent(userId, 'message_sent', category, {
      messageLength: messageForHistory.length,
      imageCount: normalizedImageIds.length,
      requestId
    });

    const executeTurn = async () => {
    const dbHistory = await conversationsRepository.getConversationMessages(userId, normalizedConversationId);
    const effectiveHistory = [...dbHistory];
    const lastItem = effectiveHistory[effectiveHistory.length - 1];
    if (!lastItem || lastItem.role !== 'user' || lastItem.content !== messageForHistory) {
      effectiveHistory.push({ role: 'user', content: messageForHistory });
    }
    if (dbHistory.length > 50) {
      log('CHAT', 'long_conversation_warning', {
        requestId,
        historyCount: effectiveHistory.length,
        warning: 'مکالمه طولانی شده، ممکن است پاسخ ها کیفیت کمتری داشته باشند'
      });
    }

    const systemPrompt = await promptService.getSystemPrompt();
    const previousDocument =
      conversationMemoryService && typeof conversationMemoryService.readForConversation === 'function'
        ? await conversationMemoryService.readForConversation(normalizedConversationId, { userId }, { createIfMissing: true })
        : null;
    let messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: messageForHistory
      }
    ];
    if (conversationContextBuilder && typeof conversationContextBuilder.buildChatMessages === 'function') {
      if (resolvedImages.length > 0 && typeof conversationContextBuilder.buildImageChatMessages === 'function') {
        const imageParts = buildImageContentParts(trimmedMessage, resolvedImages).filter((part) => part.type === 'image_url');
        ({ messages } = await conversationContextBuilder.buildImageChatMessages({
          conversationId: normalizedConversationId,
          userMessage: messageForHistory,
          systemPrompt,
          owner: { userId },
          imageParts
        }));
      } else {
        ({ messages } = await conversationContextBuilder.buildChatMessages({
          conversationId: normalizedConversationId,
          userMessage: messageForHistory,
          systemPrompt,
          owner: { userId }
        }));
      }
    }

    const isFirstMessage = dbHistory.filter((item) => item.role === 'user').length === 0;
    const responseStart = Date.now();
    const aiResult = await callOpenAI(messages, { requestId });
    const responseTimeMs = Date.now() - responseStart;
    const reply = removeExtraGreeting(aiResult.reply, isFirstMessage);
    const assistantMessageCreatedAt = new Date();
    const nextConversationMessages = [...effectiveHistory, { role: 'assistant', content: reply }];
    conversationStore.set(memoryKey, nextConversationMessages);
    await conversationsRepository.saveConversationMessages(userId, normalizedConversationId, nextConversationMessages);

    let loggedTurn = null;
    if (chatMessagesRepository && typeof chatMessagesRepository.logSuccessfulTurn === 'function') {
      loggedTurn = await chatMessagesRepository.logSuccessfulTurn({
        userId,
        conversationId: normalizedConversationId,
        userMessage: messageForHistory,
        assistantResponse: reply,
        model: aiResult.model,
        responseTimeMs,
        tokenUsage: aiResult.tokenUsage,
        limitStatus,
        userCreatedAt: userMessageCreatedAt,
        assistantCreatedAt: assistantMessageCreatedAt
      });
    }

    if (conversationMemoryWriterService && typeof conversationMemoryWriterService.updateAfterTurn === 'function') {
      await conversationMemoryWriterService.updateAfterTurn({
        conversationId: normalizedConversationId,
        owner: { userId },
        previousDocument,
        userMessage: messageForHistory,
        assistantResponse: reply,
        sourceUserMessageId: loggedTurn?.userMessageId || null,
        sourceAssistantMessageId: loggedTurn?.assistantMessageId || null
      });
    }

    await eventsRepository.logEvent(userId, 'message_received', category, {
      responseLength: reply.length,
      requestId
    });

    return { reply, conversationId: normalizedConversationId };
    };

    if (conversationMemoryWriterService && typeof conversationMemoryWriterService.runExclusive === 'function') {
      return conversationMemoryWriterService.runExclusive(normalizedConversationId, executeTurn);
    }
    return executeTurn();
  };

  const streamChatMessage = async ({ message, profile, conversationId, imageIds, requestId, limitStatus = null, turnId, signal, onDelta }) => {
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';
    const normalizedImageIds = normalizeImageIds(imageIds);
    if (!trimmedMessage && normalizedImageIds.length === 0) {
      throw Object.assign(new Error('INVALID_MESSAGE'), { code: 'INVALID_MESSAGE' });
    }
    const resolvedImages = normalizedImageIds.length > 0 ? await uploadedImagesRepository.getByIds(normalizedImageIds) : [];
    if (resolvedImages.length !== normalizedImageIds.length) {
      throw Object.assign(new Error('IMAGE_NOT_FOUND'), { code: 'IMAGE_NOT_FOUND' });
    }
    const userId = await usersRepository.ensureUserExists(profile || {});
    const normalizedConversationId = typeof conversationId === 'string' && conversationId.trim() ? conversationId.trim() : 'default';
    const messageForHistory = trimmedMessage || '📷 عکس ارسال شد';
    const category = detectCategory(messageForHistory);
    await conversationsRepository.ensureConversation(userId, normalizedConversationId);

    const executeTurn = async () => {
      const dbHistory = await conversationsRepository.getConversationMessages(userId, normalizedConversationId);
      const systemPrompt = await promptService.getSystemPrompt();
      const previousDocument = conversationMemoryService?.readForConversation
        ? await conversationMemoryService.readForConversation(normalizedConversationId, { userId }, { createIfMissing: true })
        : null;
      let messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: messageForHistory }];
      if (conversationContextBuilder?.buildChatMessages) {
        if (resolvedImages.length > 0 && conversationContextBuilder.buildImageChatMessages) {
          const imageParts = buildImageContentParts(trimmedMessage, resolvedImages).filter((part) => part.type === 'image_url');
          ({ messages } = await conversationContextBuilder.buildImageChatMessages({
            conversationId: normalizedConversationId,
            userMessage: messageForHistory,
            systemPrompt,
            owner: { userId },
            imageParts
          }));
        } else {
          ({ messages } = await conversationContextBuilder.buildChatMessages({
            conversationId: normalizedConversationId,
            userMessage: messageForHistory,
            systemPrompt,
            owner: { userId }
          }));
        }
      }

      let reply = '';
      const responseStart = Date.now();
      const aiResult = await callOpenAIStream(messages, {
        requestId,
        signal,
        onDelta: async (delta) => {
          reply += delta;
          await onDelta(delta);
        }
      });
      reply = reply.trim();
      if (!reply) throw Object.assign(new Error('EMPTY_UPSTREAM_REPLY'), { code: 'EMPTY_UPSTREAM_REPLY' });

      const nextMessages = [
        ...dbHistory,
        { id: `${turnId}-user`, role: 'user', content: messageForHistory },
        { id: `${turnId}-assistant`, role: 'assistant', content: reply }
      ];
      await conversationsRepository.saveConversationMessages(userId, normalizedConversationId, nextMessages);
      let loggedTurn = null;
      if (chatMessagesRepository?.logSuccessfulTurn) {
        loggedTurn = await chatMessagesRepository.logSuccessfulTurn({
          userId,
          conversationId: normalizedConversationId,
          turnId,
          userMessage: messageForHistory,
          assistantResponse: reply,
          model: aiResult.model,
          responseTimeMs: Date.now() - responseStart,
          tokenUsage: aiResult.tokenUsage,
          limitStatus,
          userCreatedAt: new Date(responseStart),
          assistantCreatedAt: new Date()
        });
      }
      if (conversationMemoryWriterService?.updateAfterTurn) {
        await conversationMemoryWriterService.updateAfterTurn({
          conversationId: normalizedConversationId,
          owner: { userId },
          previousDocument,
          userMessage: messageForHistory,
          assistantResponse: reply,
          sourceUserMessageId: loggedTurn?.userMessageId || null,
          sourceAssistantMessageId: loggedTurn?.assistantMessageId || null
        }).catch((error) => {
          log('CHAT', 'stream_memory_update_failed', {
            requestId,
            turnId,
            message: error instanceof Error ? error.message : String(error || '')
          });
        });
      }
      await eventsRepository.logEvent(userId, 'message_received', category, { responseLength: reply.length, requestId, turnId });
      return { reply, conversationId: normalizedConversationId, model: aiResult.model, tokenUsage: aiResult.tokenUsage };
    };

    return conversationMemoryWriterService?.runExclusive
      ? conversationMemoryWriterService.runExclusive(normalizedConversationId, executeTurn)
      : executeTurn();
  };

  const classifyIntent = async (message, { requestId } = {}) => {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return 'chat';

    const result = await callOpenAI(
      [
        {
          role: 'system',
          content:
            'Classify the user intent for a Persian chat app. Reply with exactly one token: chat, image_generation, image_edit, or image_understanding. Choose image_generation only when the user wants a new image made. Choose image_edit only when they ask to modify an existing image. Choose image_understanding when they ask to read, describe, OCR, review, or analyze an existing image. Otherwise choose chat.'
        },
        { role: 'user', content: text }
      ],
      { requestId }
    );

    const value = String(result.reply || '').trim().toLowerCase();
    if (value.includes('image_edit')) return 'image_edit';
    if (value.includes('image_understanding')) return 'image_understanding';
    if (value.includes('image_generation')) return 'image_generation';
    return 'chat';
  };

  const enhanceImagePrompt = async (prompt, { requestId, intent = 'image_generation' } = {}) => {
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (!text) return '';

    try {
      const isEdit = intent === 'image_edit';
      const result = await callOpenAI(
        [
          {
            role: 'system',
            content: isEdit
              ? 'You are a prompt engineer for an image-to-image editing model. Rewrite the user request into one concise English edit instruction. The model will receive an input image. The prompt must say to use the input image as the base, preserve subject identity, pose, composition, lighting, and style unless explicitly changed, and change only the requested part. Keep it child-friendly. Return only the final edit prompt, no markdown, no explanation.'
              : 'You are a prompt engineer for a text-to-image model. Rewrite the user request into one concise English image prompt. Preserve the exact main subject and all requested attributes. Never replace a requested human/person with an animal, object, doll, mascot, or unrelated character. If the subject is a child, keep it age-appropriate, wholesome, fully clothed, and non-sexualized. Return only the final image prompt, no markdown, no explanation.'
          },
          {
            role: 'user',
            content: `Intent: ${intent}\nUser prompt: ${text}`
          }
        ],
        { requestId }
      );

      const enhanced = String(result?.reply || '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^final image prompt\s*:\s*/i, '')
        .trim();

      if (!enhanced || enhanced.length < 8) return '';
      if (enhanced.length > 1200) return enhanced.slice(0, 1200).trim();
      return enhanced;
    } catch (error) {
      log('IMAGE_PROMPT', 'enhancer_failed', {
        requestId,
        message: error instanceof Error ? error.message : String(error || '')
      });
      return '';
    }
  };

  const appendUniqueMessages = (currentMessages, nextMessages) => {
    const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
    const seenIds = new Set(messages.map((item) => String(item?.id || '')).filter(Boolean));

    for (const messageItem of nextMessages) {
      const id = String(messageItem?.id || '').trim();
      if (id && seenIds.has(id)) {
        continue;
      }
      if (!id) {
        const duplicate = messages.some(
          (item) =>
            item?.role === messageItem?.role &&
            item?.content === messageItem?.content &&
            item?.type === messageItem?.type &&
            String(item?.taskId || '') === String(messageItem?.taskId || '')
        );
        if (duplicate) continue;
      }
      if (id) seenIds.add(id);
      messages.push(messageItem);
    }

    return messages;
  };

  const persistImageChatTurn = async ({
    userId,
    conversationId,
    userMessage,
    assistantText,
    taskId = null,
    status = null,
    imageUrl = null,
    intent = 'image_generation',
    errorCode = null,
    requestId,
    clientMessageId = null
  }) => {
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';
    const prompt = typeof userMessage === 'string' && userMessage.trim() ? userMessage.trim() : 'درخواست ساخت تصویر';
    const now = new Date().toISOString();
    const userMessageId = clientMessageId || makeMessageId('user-image');
    const assistantMessageId = taskId ? makeMessageId('assistant-image') : null;
    const loadingMessageId = taskId ? `image-task-${taskId}` : makeMessageId('image-error');

    const currentMessages = await conversationsRepository.getConversationMessages(userId, normalizedConversationId);
    if (clientMessageId && currentMessages.some((message) => String(message?.id || '') === String(clientMessageId))) {
      return currentMessages;
    }

    const messagesToAppend = [
      {
        id: userMessageId,
        role: 'user',
        type: 'text',
        intent,
        content: prompt,
        timestamp: now
      }
    ];

    if (taskId) {
      messagesToAppend.push({
        id: assistantMessageId,
        role: 'assistant',
        type: 'text',
        intent,
        content: assistantText,
        timestamp: now
      });
    }

    if (taskId) {
      messagesToAppend.push({
        id: loadingMessageId,
        role: 'assistant',
        type: 'image_loading',
        intent,
        content: 'در حال ساخت تصویر...',
        taskId: String(taskId),
        status: status || 'QUEUE',
        timestamp: now
      });
    } else {
      messagesToAppend.push({
        id: loadingMessageId,
        role: 'assistant',
        type: 'image_error',
        intent,
        content: assistantText,
        status: 'ERROR',
        timestamp: now
      });
    }

    if (imageUrl) {
      messagesToAppend[messagesToAppend.length - 1] = {
        ...messagesToAppend[messagesToAppend.length - 1],
        type: 'image_result',
        content: 'تصویر آماده شد.',
        status: 'COMPLETED',
        images: [{ url: imageUrl, alt: prompt }]
      };
    }

    const nextMessages = appendUniqueMessages(currentMessages, messagesToAppend);
    await conversationsRepository.saveConversationMessages(userId, normalizedConversationId, nextMessages);
    conversationStore.set(`${userId}:${normalizedConversationId}`, nextMessages);

    await eventsRepository.logEvent(
      userId,
      intent === 'image_edit' ? 'image_edit_requested' : 'image_generation_requested',
      intent,
      {
        messageLength: prompt.length,
        taskId: taskId ? String(taskId) : null,
        requestId,
        status: status || (errorCode ? 'ERROR' : 'QUEUE')
      }
    );

    if (errorCode) {
      await eventsRepository.logEvent(userId, intent === 'image_edit' ? 'image_edit_failed' : 'image_generation_failed', intent, {
        taskId: taskId ? String(taskId) : null,
        requestId,
        errorCode
      });
    }

    let sourceUserMessageId = null;
    let sourceAssistantMessageId = null;
    if (chatMessagesRepository && typeof chatMessagesRepository.logMessage === 'function') {
      sourceUserMessageId = await chatMessagesRepository.logMessage({
        userId,
        conversationId: normalizedConversationId,
        role: 'user',
        content: prompt,
        limitStatus: intent
      });
      sourceAssistantMessageId = await chatMessagesRepository.logMessage({
        userId,
        conversationId: normalizedConversationId,
        role: 'assistant',
        content: taskId ? `${assistantText}\nTASK:${taskId}` : assistantText,
        errorCode,
        limitStatus: taskId ? `${intent}_queued` : `${intent}_not_started`
      });
    }

    if (
      conversationMemoryService &&
      conversationMemoryService.isValidConversationId?.(normalizedConversationId) &&
      conversationMemoryWriterService &&
      typeof conversationMemoryWriterService.enqueueUpdateAfterTurn === 'function'
    ) {
      await conversationMemoryWriterService.enqueueUpdateAfterTurn({
        conversationId: normalizedConversationId,
        owner: { userId },
        userMessage: prompt,
        assistantResponse: taskId
          ? `${assistantText}\nImage task reference: ${taskId}`
          : assistantText,
        sourceUserMessageId,
        sourceAssistantMessageId
      });
    }

    return messagesToAppend;
  };

  const persistVisionChatTurn = async ({
    userId,
    profile,
    conversationId,
    userMessage,
    assistantText,
    requestId,
    clientMessageId = null,
    imageIds = [],
    diagnostics = null,
    limitStatus = null,
    turnId = null
  }) => {
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';
    const effectiveUserId = userId || await usersRepository.ensureUserExists(profile || {});
    const prompt = typeof userMessage === 'string' && userMessage.trim() ? userMessage.trim() : '📷 عکس ارسال شد';
    const now = new Date().toISOString();
    const userMessageId = clientMessageId || (turnId ? `${turnId}-user` : makeMessageId('user-vision'));
    const currentMessages = await conversationsRepository.getConversationMessages(effectiveUserId, normalizedConversationId);
    const currentHasClientMessage = clientMessageId && currentMessages.some((message) => String(message?.id || '') === String(clientMessageId));
    const userImages = Array.isArray(imageIds)
      ? imageIds
          .filter((imageId) => typeof imageId === 'string' && imageId.trim())
          .slice(0, 5)
          .map((imageId, index) => ({
            url: `/api/uploads/images/${encodeURIComponent(imageId.trim())}`,
            alt: `تصویر ارسال شده ${index + 1}`
          }))
      : [];
    const messagesToAppend = [
      ...(currentHasClientMessage ? [] : [{
        id: userMessageId,
        role: 'user',
        type: 'text',
        intent: 'image_understanding',
        content: prompt,
        timestamp: now,
        ...(userImages.length > 0 ? { images: userImages } : {})
      }]),
      {
        id: turnId ? `${turnId}-assistant` : makeMessageId('assistant-vision'),
        role: 'assistant',
        type: 'text',
        intent: 'image_understanding',
        content: assistantText,
        timestamp: now
      }
    ];

    const nextMessages = appendUniqueMessages(currentMessages, messagesToAppend);
    await conversationsRepository.saveConversationMessages(effectiveUserId, normalizedConversationId, nextMessages);
    conversationStore.set(`${effectiveUserId}:${normalizedConversationId}`, nextMessages);

    if (eventsRepository && typeof eventsRepository.logEvent === 'function') {
      await eventsRepository.logEvent(effectiveUserId, 'image_understanding_completed', 'image_understanding', {
        messageLength: prompt.length,
        imageCount: Array.isArray(imageIds) ? imageIds.length : 0,
        requestId,
        model: diagnostics?.model || null,
        transport: diagnostics?.transport || null,
        durationMs: diagnostics?.durationMs ?? null
      });
    }

    let sourceUserMessageId = null;
    let sourceAssistantMessageId = null;
    if (chatMessagesRepository && typeof chatMessagesRepository.logMessage === 'function') {
      sourceUserMessageId = await chatMessagesRepository.logMessage({
        userId: effectiveUserId,
        conversationId: normalizedConversationId,
        turnId,
        role: 'user',
        content: prompt,
        limitStatus: limitStatus || 'image_understanding'
      });
      sourceAssistantMessageId = await chatMessagesRepository.logMessage({
        userId: effectiveUserId,
        conversationId: normalizedConversationId,
        turnId,
        role: 'assistant',
        content: assistantText,
        limitStatus: diagnostics?.transport ? `image_understanding_${diagnostics.transport}` : 'image_understanding'
      });
    }

    if (
      conversationMemoryService &&
      conversationMemoryService.isValidConversationId?.(normalizedConversationId) &&
      conversationMemoryWriterService &&
      typeof conversationMemoryWriterService.enqueueUpdateAfterTurn === 'function'
    ) {
      await conversationMemoryWriterService.enqueueUpdateAfterTurn({
        conversationId: normalizedConversationId,
        owner: { userId: effectiveUserId },
        userMessage: prompt,
        assistantResponse: assistantText,
        sourceUserMessageId,
        sourceAssistantMessageId
      });
    }

    return {
      userId: effectiveUserId,
      messages: messagesToAppend
    };
  };

  const composeVisionChatReply = async ({
    userId,
    profile,
    conversationId,
    userMessage,
    visionAnalysis,
    requestId
  }) => {
    const prompt = typeof userMessage === 'string' && userMessage.trim()
      ? userMessage.trim()
      : 'محتوای این تصویر را برایم توضیح بده.';
    const groundedVision = typeof visionAnalysis === 'string' ? visionAnalysis.trim() : '';
    if (!groundedVision) {
      const error = new Error('EMPTY_VISION_REPLY');
      error.code = 'EMPTY_VISION_REPLY';
      throw error;
    }

    const effectiveUserId = userId || await usersRepository.ensureUserExists(profile || {});
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';
    const baseSystemPrompt = await promptService.getSystemPrompt();
    const visionGroundingInstruction = [
      'برای این نوبت، یک سامانهٔ بینایی محتوای تصویر پیوست‌شده را بررسی کرده است.',
      'مشاهدات بینایی زیر را مانند اطلاعاتی که خودت مستقیماً از تصویر دیده‌ای به کار ببر.',
      'به درخواست اصلی کاربر پاسخ بده؛ دربارهٔ ماژول بینایی، زنجیرهٔ پردازش، متن واسط یا محدودیت دسترسی به تصویر صحبت نکن.',
      'اگر مشاهدات قطعی نیستند، با زبان طبیعی و کوتاه عدم قطعیت را بیان کن و چیزی خارج از مشاهدات نساز.',
      'لحن، ایمنی، زبان و شخصیت تعریف‌شده در دستورهای اصلی چت را حفظ کن.'
    ].join('\n');
    const groundedUserMessage = [
      'درخواست اصلی کاربر:',
      prompt,
      '',
      'مشاهدات استخراج‌شده از تصویر:',
      groundedVision,
      '',
      'اکنون مستقیماً و طبیعی به درخواست اصلی کاربر پاسخ بده.'
    ].join('\n');

    let messages = [
      { role: 'system', content: `${baseSystemPrompt}\n\n${visionGroundingInstruction}`.trim() },
      { role: 'user', content: groundedUserMessage }
    ];
    if (conversationContextBuilder && typeof conversationContextBuilder.buildChatMessages === 'function') {
      ({ messages } = await conversationContextBuilder.buildChatMessages({
        conversationId: normalizedConversationId,
        userMessage: groundedUserMessage,
        systemPrompt: `${baseSystemPrompt}\n\n${visionGroundingInstruction}`.trim(),
        owner: { userId: effectiveUserId }
      }));
    }

    const responseStart = Date.now();
    const aiResult = await callOpenAI(messages, { requestId });
    const reply = typeof aiResult?.reply === 'string' ? aiResult.reply.trim() : '';
    if (!reply) {
      const error = new Error('EMPTY_UPSTREAM_REPLY');
      error.code = 'EMPTY_UPSTREAM_REPLY';
      throw error;
    }

    log('VISION_CHAT', 'response_composed', {
      requestId,
      conversationId: normalizedConversationId,
      visionAnalysisLength: groundedVision.length,
      replyLength: reply.length,
      model: aiResult.model
    });

    return {
      reply,
      model: aiResult.model,
      tokenUsage: aiResult.tokenUsage,
      responseTimeMs: Date.now() - responseStart
    };
  };

  return {
    sendChatMessage,
    streamChatMessage,
    callOpenAI,
    callOpenAIStream,
    classifyIntent,
    enhanceImagePrompt,
    persistImageChatTurn,
    persistVisionChatTurn,
    composeVisionChatReply
  };
}

module.exports = { createAiService };
