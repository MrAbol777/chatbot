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

const buildChatMessages = (messages) =>
  (Array.isArray(messages) ? messages : [])
    .filter(
      (item) =>
        item &&
        (item.role === 'system' || item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
    )
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }));

const extractReply = (response) => {
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
  logger = console
}) {
  const log = (scope, message, meta) => {
    if (typeof logger.log === 'function') {
      logger.log(scope, message, meta);
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

  const sendChatMessage = async ({ message, profile, history, conversationId, requestId }) => {
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    log('CHAT', 'incoming_message', {
      requestId,
      hasProfile: Boolean(profile),
      historyCount: Array.isArray(history) ? history.length : 0,
      messageLength: trimmedMessage.length
    });

    if (!apiKey) {
      const error = new Error('METIS_API_KEY is missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    if (!trimmedMessage) {
      const error = new Error('INVALID_MESSAGE');
      error.code = 'INVALID_MESSAGE';
      throw error;
    }

    const userId = await usersRepository.ensureUserExists(profile || {});
    const category = detectCategory(trimmedMessage);
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';
    const memoryKey = `${userId}:${normalizedConversationId}`;

    await eventsRepository.logEvent(userId, 'message_sent', category, {
      messageLength: trimmedMessage.length,
      requestId
    });

    const normalizedHistory = normalizeHistory(history, trimmedMessage);
    const storedHistory = conversationStore.get(memoryKey);
    const dbHistory = await conversationsRepository.getConversationMessages(userId, normalizedConversationId);
    let effectiveHistory =
      Array.isArray(storedHistory) && storedHistory.length > normalizedHistory.length ? [...storedHistory] : normalizedHistory;
    if (dbHistory.length > effectiveHistory.length) {
      effectiveHistory = [...dbHistory];
    }
    const lastItem = effectiveHistory[effectiveHistory.length - 1];
    if (!lastItem || lastItem.role !== 'user' || lastItem.content !== trimmedMessage) {
      effectiveHistory.push({ role: 'user', content: trimmedMessage });
    }
    if (normalizedHistory.length > 50) {
      log('CHAT', 'long_conversation_warning', {
        requestId,
        historyCount: effectiveHistory.length,
        warning: 'مکالمه طولانی شده، ممکن است پاسخ ها کیفیت کمتری داشته باشند'
      });
    }

    const systemPrompt = await promptService.getSystemPrompt();
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...effectiveHistory
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
