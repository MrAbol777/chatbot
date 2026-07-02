const {
  nowIso,
  toDate,
  normalizeConversationId,
  safeJsonArray
} = require('./helpers');
const { getGuestIdFromUserId } = require('./GuestRepository');

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
  const intent = ['chat', 'image_generation', 'image_edit'].includes(item.intent) ? item.intent : undefined;
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
  const taskIndexes = new Map();
  const imageUrlIndexes = new Map();

  const remember = (message, index) => {
    const taskId = getMessageTaskId(message);
    if (taskId) taskIndexes.set(taskId, index);
    getMessageImageDedupeUrls(message).forEach((url) => imageUrlIndexes.set(url, index));
  };

  for (const message of Array.isArray(messages) ? messages : []) {
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
    remember(message, deduped.length - 1);
  }

  return deduped;
};

class ConversationRepository {
  constructor(db) {
    this.db = db;
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
    const guestId = getGuestIdFromUserId(normalizedUserId) || null;
    const normalizedConversationId = normalizeConversationId(conversationId);
    const ts = new Date();

    await this.db.query(
      `INSERT INTO app_conversations (user_id, guest_id, conversation_id, title, pinned, messages, created_at, updated_at)
       VALUES (?, ?, ?, '', 0, ?, ?, ?)
       ON DUPLICATE KEY UPDATE guest_id = VALUES(guest_id), messages = VALUES(messages), updated_at = VALUES(updated_at)`,
      [normalizedUserId, guestId, normalizedConversationId, JSON.stringify(safeMessages), ts, ts]
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
        pinned: Boolean(item.pinned),
        created_at: item.created_at || nowIso(),
        updated_at: item.updated_at || item.created_at || nowIso(),
        messages: dedupeConversationMessages(safeJsonArray(messages).map((msg) => normalizeMessage(msg)).filter(Boolean))
      };
    });
  }

  async replaceUserConversations(userId, conversations) {
    await this.db.init();
    const targetId = String(userId || '').trim();
    if (!targetId) return 0;

    const safeConversations = Array.isArray(conversations) ? conversations : [];
    const conn = await this.db.getConnection();

    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM app_conversations WHERE user_id = ?', [targetId]);

      for (const item of safeConversations) {
        const conversationId =
          typeof item?.conversation_id === 'string' && item.conversation_id.trim()
            ? item.conversation_id.trim()
            : 'default';
        const safeMessages = Array.isArray(item?.messages)
          ? dedupeConversationMessages(item.messages.map((msg) => normalizeMessage(msg, nowIso())).filter(Boolean)).slice(-200)
          : [];

        await conn.query(
          'INSERT INTO app_conversations (user_id, guest_id, conversation_id, title, pinned, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            targetId,
            getGuestIdFromUserId(targetId) || null,
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
}

module.exports = { ConversationRepository };
