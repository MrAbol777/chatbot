const {
  nowIso,
  toDate,
  normalizeConversationId,
  safeJsonArray
} = require('./helpers');

const normalizeMessage = (item, fallbackTimestamp = nowIso()) => {
  if (!item || (item.role !== 'user' && item.role !== 'assistant')) {
    return null;
  }

  const content = typeof item.content === 'string' ? item.content.trim() : '';
  const images = Array.isArray(item.images)
    ? item.images
        .filter((image) => image && typeof image.url === 'string' && image.url.trim())
        .slice(0, 5)
        .map((image) => ({
          url: image.url.trim(),
          alt: typeof image.alt === 'string' ? image.alt.trim() : ''
        }))
    : undefined;
  const type = ['text', 'image_loading', 'image_result', 'image_error'].includes(item.type) ? item.type : undefined;
  const taskId = typeof item.taskId === 'string' || typeof item.taskId === 'number' ? String(item.taskId).trim() : '';
  const imageTaskId =
    typeof item.imageTaskId === 'string' || typeof item.imageTaskId === 'number' ? String(item.imageTaskId).trim() : '';
  const status = ['QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED'].includes(item.status)
    ? item.status
    : undefined;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : undefined;
  const intent = ['chat', 'image_generation', 'image_edit', 'image_understanding'].includes(item.intent) ? item.intent : undefined;
  const timestamp = typeof item.timestamp === 'string' && item.timestamp.trim() ? item.timestamp.trim() : fallbackTimestamp;
  const imageUrl = typeof item.imageUrl === 'string' && item.imageUrl.trim() ? item.imageUrl.trim() : undefined;
  const resultUrl = typeof item.resultUrl === 'string' && item.resultUrl.trim() ? item.resultUrl.trim() : undefined;

  if (!content && (!images || images.length === 0) && !imageUrl && !resultUrl && !type) {
    return null;
  }

  return {
    ...(id ? { id } : {}),
    role: item.role,
    type: type || (images && images.length > 0 ? 'image_result' : 'text'),
    content,
    timestamp,
    ...(intent ? { intent } : {}),
    ...(taskId ? { taskId } : {}),
    ...(imageTaskId ? { imageTaskId } : {}),
    ...(status ? { status } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(resultUrl ? { resultUrl } : {}),
    ...(Array.isArray(images) && images.length > 0 ? { images } : {})
  };
};

const normalizeImageDedupeUrl = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://danoa.ir');
    return parsed.pathname.replace(/\/+$/, '') || parsed.pathname;
  } catch {
    return raw.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
};

const getMessageTaskId = (message) => {
  const candidate = message?.taskId || message?.imageTaskId;
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).trim() : '';
};

const getMessageImageUrls = (message) => {
  const imageUrls = Array.isArray(message?.images) ? message.images.map((image) => image?.url) : [];
  return Array.from(
    new Set(
      [message?.imageUrl, message?.resultUrl, Array.isArray(message?.images) ? message.images[0]?.url : undefined, ...imageUrls]
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter(Boolean)
    )
  );
};

const getMessageImageDedupeUrls = (message) =>
  Array.from(new Set(getMessageImageUrls(message).map(normalizeImageDedupeUrl).filter(Boolean)));

const imageMessagePriority = (message) => {
  if (message?.type === 'image_result') return 30;
  if (message?.type === 'image_error') return 20;
  if (message?.type === 'image_loading') return 10;
  return 0;
};

const imageMessageCompleteness = (message) => {
  const readyText = /عکس آماده شد|تصویر آماده شد/.test(message?.content || '') ? 2 : 0;
  return (
    imageMessagePriority(message) +
    (getMessageImageDedupeUrls(message).length > 0 ? 6 : 0) +
    (message?.status === 'COMPLETED' ? 4 : 0) +
    readyText +
    (getMessageTaskId(message) ? 1 : 0)
  );
};

const mergeImageMessages = (current, next) => {
  const base = imageMessageCompleteness(next) >= imageMessageCompleteness(current) ? next : current;
  const fallback = base === next ? current : next;
  const taskId = getMessageTaskId(current) || getMessageTaskId(next);
  return {
    ...fallback,
    ...base,
    id: current.id || next.id,
    timestamp: current.timestamp || next.timestamp,
    ...(taskId ? { taskId } : {}),
    images: getMessageImageUrls(base).length > 0 ? base.images : fallback.images,
    imageUrl: base.imageUrl || fallback.imageUrl,
    resultUrl: base.resultUrl || fallback.resultUrl
  };
};

const dedupeConversationMessages = (messages) => {
  const deduped = [];
  const messageIdIndexes = new Map();
  const taskIndexes = new Map();
  const imageUrlIndexes = new Map();

  const remember = (message, index) => {
    const taskId = getMessageTaskId(message);
    if (taskId) taskIndexes.set(taskId, index);
    getMessageImageDedupeUrls(message).forEach((url) => imageUrlIndexes.set(url, index));
  };

  for (const message of Array.isArray(messages) ? messages : []) {
    const messageId = typeof message?.id === 'string' ? message.id.trim() : '';
    if (messageId && messageIdIndexes.has(messageId)) {
      deduped[messageIdIndexes.get(messageId)] = message;
      continue;
    }
    const isImageMessage =
      message?.role === 'assistant' &&
      (message.type === 'image_loading' ||
        message.type === 'image_result' ||
        message.type === 'image_error' ||
        getMessageImageDedupeUrls(message).length > 0);

    if (isImageMessage) {
      const taskId = getMessageTaskId(message);
      const imageUrls = getMessageImageDedupeUrls(message);
      const existingIndex =
        (taskId ? taskIndexes.get(taskId) : undefined) ??
        imageUrls.map((url) => imageUrlIndexes.get(url)).find((index) => index !== undefined);

      if (existingIndex !== undefined) {
        deduped[existingIndex] = mergeImageMessages(deduped[existingIndex], message);
        remember(deduped[existingIndex], existingIndex);
        continue;
      }
    }

    deduped.push(message);
    if (messageId) messageIdIndexes.set(messageId, deduped.length - 1);
    remember(message, deduped.length - 1);
  }

  return deduped;
};

class ConversationRepository {
  constructor(db) {
    this.db = db;
  }

  async ensureConversation(userId, conversationId, options = {}) {
    await this.db.init();
    const normalizedUserId = typeof userId === 'string' || typeof userId === 'number' ? String(userId).trim() : '';
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedUserId || !normalizedConversationId) return null;

    const ts = new Date();
    await this.db.query(
      `INSERT INTO app_conversations (user_id, conversation_id, title, title_source, title_generation_status, pinned, messages, created_at, updated_at)
       VALUES (?, ?, ?, 'default', 'pending', 0, ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [
        normalizedUserId,
        normalizedConversationId,
        typeof options.title === 'string' ? options.title.trim() : '',
        JSON.stringify(Array.isArray(options.messages) ? options.messages : []),
        ts,
        ts
      ]
    );

    return {
      user_id: normalizedUserId,
      conversation_id: normalizedConversationId,
      created_at: ts,
      updated_at: ts
    };
  }

  async getConversationMessages(userId, conversationId) {
    await this.db.init();
    const normalizedUserId = typeof userId === 'string' || typeof userId === 'number' ? String(userId) : '';
    const normalizedConversationId = normalizeConversationId(conversationId);
    const [rows] = await this.db.query(
      'SELECT messages FROM app_conversations WHERE user_id = ? AND conversation_id = ? LIMIT 1',
      [normalizedUserId, normalizedConversationId]
    );
    const raw = rows[0]?.messages;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return safeJsonArray(parsed)
      .map((item) => normalizeMessage(item))
      .filter(Boolean);
  }

  async saveConversationMessages(userId, conversationId, messages) {
    await this.db.init();
    if (!userId) return;
    const safeMessages = Array.isArray(messages)
      ? dedupeConversationMessages(messages.map((item) => normalizeMessage(item)).filter(Boolean)).slice(-100)
      : [];

    const normalizedUserId = String(userId);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const ts = new Date();

    await this.db.query(
      `INSERT INTO app_conversations (user_id, conversation_id, title, title_source, title_generation_status, pinned, messages, created_at, updated_at)
       VALUES (?, ?, '', 'default', 'pending', 0, ?, ?, ?)
       ON DUPLICATE KEY UPDATE messages = VALUES(messages), updated_at = VALUES(updated_at)`,
      [normalizedUserId, normalizedConversationId, JSON.stringify(safeMessages), ts, ts]
    );
  }

  async getUserConversations(userId) {
    await this.db.init();
    const targetId = String(userId || '').trim();
    if (!targetId) return [];

    const [rows] = await this.db.query('SELECT * FROM app_conversations WHERE user_id = ? ORDER BY updated_at DESC', [
      targetId
    ]);

    return rows.map((item) => {
      const messages = typeof item.messages === 'string' ? JSON.parse(item.messages || '[]') : item.messages;
      return {
        conversation_id: String(item.conversation_id || 'default'),
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
        generated_title: typeof item.generated_title === 'string' && item.generated_title.trim() ? item.generated_title.trim() : null,
        title_source: ['default', 'generated', 'manual'].includes(item.title_source) ? item.title_source : 'default',
        title_generation_status: item.title_generation_status || null,
        title_model: item.title_model || null,
        title_generator_version: item.title_generator_version || null,
        title_generation_latency_ms: Number.isFinite(Number(item.title_generation_latency_ms)) ? Number(item.title_generation_latency_ms) : null,
        title_generated_at: item.title_generated_at || null,
        title_manually_updated_at: item.title_manually_updated_at || null,
        pinned: Boolean(item.pinned),
        created_at: item.created_at || nowIso(),
        updated_at: item.updated_at || item.created_at || nowIso(),
        messages: dedupeConversationMessages(safeJsonArray(messages).map((msg) => normalizeMessage(msg)).filter(Boolean))
      };
    });
  }

  async getAnyConversationMessages(conversationId) {
    await this.db.init();
    const normalizedConversationId = normalizeConversationId(conversationId);
    const [rows] = await this.db.query(
      'SELECT messages FROM app_conversations WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1',
      [normalizedConversationId]
    );
    const raw = rows[0]?.messages;
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return safeJsonArray(parsed)
      .map((item) => normalizeMessage(item))
      .filter(Boolean);
  }

  async replaceUserConversations(userId, conversations) {
    await this.db.init();
    const targetId = String(userId || '').trim();
    if (!targetId) return 0;

    const safeConversations = Array.isArray(conversations) ? conversations : [];
    const conn = await this.db.getConnection();

    try {
      await conn.beginTransaction();
      for (const item of safeConversations) {
        const conversationId =
          typeof item?.conversation_id === 'string' && item.conversation_id.trim()
            ? item.conversation_id.trim()
            : 'default';
        const safeMessages = Array.isArray(item?.messages)
          ? dedupeConversationMessages(item.messages.map((msg) => normalizeMessage(msg, nowIso())).filter(Boolean)).slice(-200)
          : [];

        await conn.query(
          `INSERT INTO app_conversations (user_id, conversation_id, title, title_source, title_generation_status, pinned, messages, created_at, updated_at)
           VALUES (?, ?, ?, 'default', 'pending', ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             title = CASE WHEN title_source IN ('generated', 'manual') THEN title ELSE VALUES(title) END,
             pinned = VALUES(pinned), messages = VALUES(messages), updated_at = VALUES(updated_at)`,
          [
            targetId,
            conversationId,
            typeof item?.title === 'string' ? item.title.trim() : '',
            Boolean(item?.pinned) ? 1 : 0,
            JSON.stringify(safeMessages),
            toDate(item?.created_at || nowIso()),
            toDate(item?.updated_at || item?.created_at || nowIso())
          ]
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    return safeConversations.length;
  }

  async updateImageTaskMessage(userId, conversationId, taskId, patch = {}) {
    await this.db.init();
    const normalizedUserId = String(userId || '').trim();
    const normalizedConversationId = normalizeConversationId(conversationId);
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedUserId || !normalizedTaskId) return false;

    const messages = await this.getConversationMessages(normalizedUserId, normalizedConversationId);
    let changed = false;
    const nextMessages = messages.map((message) => {
      if (String(message.taskId || '') !== normalizedTaskId) {
        return message;
      }
      changed = true;
      return normalizeMessage({ ...message, ...patch }, message.timestamp) || message;
    });

    if (!changed) {
      return false;
    }

    await this.saveConversationMessages(normalizedUserId, normalizedConversationId, nextMessages);
    return true;
  }

  async claimTitleGeneration(userId, conversationId) {
    await this.db.init();
    const [result] = await this.db.query(
      `UPDATE app_conversations
       SET title_generation_status = 'generating', updated_at = updated_at
       WHERE user_id = ? AND conversation_id = ?
         AND title_source = 'default' AND title_generation_status = 'pending'
         AND JSON_LENGTH(messages) <= 1`,
      [String(userId || '').trim(), normalizeConversationId(conversationId)]
    );
    return Number(result?.affectedRows || 0) === 1;
  }

  async completeGeneratedTitle(userId, conversationId, { title, model, generatorVersion, latencyMs }) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      `UPDATE app_conversations
       SET title = ?, generated_title = ?, title_source = 'generated', title_generation_status = 'completed',
           title_model = ?, title_generator_version = ?, title_generation_latency_ms = ?, title_generated_at = ?, updated_at = ?
       WHERE user_id = ? AND conversation_id = ? AND title_source <> 'manual' AND title_generation_status = 'generating'`,
      [title, title, model || null, generatorVersion || null, Number(latencyMs) || null, now, now, String(userId || '').trim(), normalizeConversationId(conversationId)]
    );
    return Number(result?.affectedRows || 0) === 1;
  }

  async completeFallbackTitle(userId, conversationId, { title, model, version, latencyMs, errorCode }) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      `UPDATE app_conversations
       SET title = ?, generated_title = ?, title_source = 'generated', title_generation_status = 'fallback',
           title_model = ?, title_generator_version = ?, title_generation_latency_ms = ?, title_generated_at = ?, updated_at = ?
       WHERE user_id = ? AND conversation_id = ? AND title_source <> 'manual' AND title_generation_status = 'generating'`,
      [title, title, model || null, version || null, Number(latencyMs) || null, now, now, String(userId || '').trim(), normalizeConversationId(conversationId)]
    );
    if (Number(result?.affectedRows || 0) !== 1) return false;
    if (errorCode) {
      // The database intentionally stores no provider response or input payload; error detail stays in logs only.
    }
    return true;
  }

  async setManualTitle(userId, conversationId, title) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      `UPDATE app_conversations
       SET title = ?, title_source = 'manual', title_manually_updated_at = ?, updated_at = ?
       WHERE user_id = ? AND conversation_id = ?`,
      [title, now, now, String(userId || '').trim(), normalizeConversationId(conversationId)]
    );
    return Number(result?.affectedRows || 0) === 1;
  }

  async conversationExists(conversationId) {
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT 1 FROM app_conversations WHERE conversation_id = ? LIMIT 1',
      [normalizeConversationId(conversationId)]
    );
    return Boolean(rows[0]);
  }
}

module.exports = { ConversationRepository };
