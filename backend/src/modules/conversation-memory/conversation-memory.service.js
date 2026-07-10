const path = require('path');
const crypto = require('crypto');
const { validate: validateUuid, v4: uuidv4 } = require('uuid');
const { REQUIRED_MEMORY_HEADINGS } = require('./conversation-memory.prompt');

const DEFAULT_STATUS = 'ready';
const SAFE_STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.memory\.md$/i;
const SECRET_PATTERN = /(api[_-]?key|access[_-]?token|authorization:\s*bearer|password|cookie:)/i;
const LARGE_BASE64_PATTERN = /(?:data:[^;]+;base64,)?[A-Za-z0-9+/]{800,}={0,2}/;

const nowIso = () => new Date().toISOString();

const normalizeConversationId = (value) => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text || '';
};

const isValidConversationId = (value) => validateUuid(normalizeConversationId(value));

const makeInitialDocument = (conversationId, timestamp = nowIso()) => `# Conversation Document

## Conversation ID
${conversationId}

## Conversation Objective
هنوز مشخص نشده است.

## Current Topic
مکالمه تازه شروع شده است.

## User Requirements
- هنوز خواسته مشخصی ثبت نشده است.

## Confirmed Facts
- هنوز اطلاعات مهمی ثبت نشده است.

## Decisions Made
- هنوز تصمیمی ثبت نشده است.

## Corrections
- موردی وجود ندارد.

## Completed Work
- موردی وجود ندارد.

## Current State
مکالمه تازه ایجاد شده است.

## Open Tasks
- موردی وجود ندارد.

## Active References
- موردی وجود ندارد.

## Important Entities
- موردی وجود ندارد.

## User Preferences
- موردی وجود ندارد.

## Last Exchange
مکالمه هنوز شروع نشده است.

## Critical Details That Must Not Be Forgotten
- موردی وجود ندارد.

## Uncertainties
- موردی وجود ندارد.

## Updated At
${timestamp}
`;

const getDocumentConversationId = (content) => {
  const match = String(content || '').match(/## Conversation ID\s+([^\r\n]+)/);
  return match ? match[1].trim() : '';
};

const validateMemoryDocument = ({ content, conversationId, maxDocumentChars = 20000 }) => {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) {
    const error = new Error('EMPTY_MEMORY_DOCUMENT');
    error.code = 'EMPTY_MEMORY_DOCUMENT';
    throw error;
  }
  if (text.length > maxDocumentChars) {
    const error = new Error('MEMORY_DOCUMENT_TOO_LARGE');
    error.code = 'MEMORY_DOCUMENT_TOO_LARGE';
    throw error;
  }
  for (const heading of REQUIRED_MEMORY_HEADINGS) {
    if (!text.includes(heading)) {
      const error = new Error(`MISSING_MEMORY_HEADING:${heading}`);
      error.code = 'MISSING_MEMORY_HEADING';
      throw error;
    }
  }
  if (getDocumentConversationId(text) !== conversationId) {
    const error = new Error('MEMORY_CONVERSATION_ID_CHANGED');
    error.code = 'MEMORY_CONVERSATION_ID_CHANGED';
    throw error;
  }
  if (SECRET_PATTERN.test(text) || LARGE_BASE64_PATTERN.test(text)) {
    const error = new Error('MEMORY_DOCUMENT_UNSAFE_CONTENT');
    error.code = 'MEMORY_DOCUMENT_UNSAFE_CONTENT';
    throw error;
  }
  return text.endsWith('\n') ? text : `${text}\n`;
};

function createConversationMemoryService({
  db,
  fileStore,
  storageRoot,
  logger = console,
  maxBackupVersions = 3
}) {
  const root = path.resolve(storageRoot);

  const ensureStorageRoot = async () => {
    await fileStore.ensureDir(root);
  };

  const makeStorageKey = (conversationId) => `${conversationId}.memory.md`;

  const resolveStoragePath = (storageKey) => {
    if (!SAFE_STORAGE_KEY_PATTERN.test(storageKey)) {
      const error = new Error('INVALID_MEMORY_STORAGE_KEY');
      error.code = 'INVALID_MEMORY_STORAGE_KEY';
      throw error;
    }
    const resolved = path.resolve(root, storageKey);
    if (resolved !== path.join(root, storageKey)) {
      const error = new Error('MEMORY_PATH_TRAVERSAL');
      error.code = 'MEMORY_PATH_TRAVERSAL';
      throw error;
    }
    return resolved;
  };

  const ensureMetadataTables = async () => {
    if (!db || typeof db.query !== 'function') return;
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversation_documents (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        conversation_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(191) NOT NULL,
        storage_key VARCHAR(191) NOT NULL,
        version INT NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        last_writer_status VARCHAR(32) NULL,
        last_writer_model VARCHAR(191) NULL,
        last_writer_duration_ms INT NULL,
        last_error_code VARCHAR(100) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_conversation_documents_conversation_id (conversation_id),
        INDEX idx_conversation_documents_conversation_id (conversation_id),
        INDEX idx_conversation_documents_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversation_document_updates (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        conversation_id VARCHAR(64) NOT NULL,
        document_version INT NOT NULL,
        source_user_message_id VARCHAR(191) NULL,
        source_assistant_message_id VARCHAR(191) NULL,
        update_status VARCHAR(32) NOT NULL,
        error_code VARCHAR(100) NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_conversation_document_updates_conversation_id (conversation_id),
        INDEX idx_conversation_document_updates_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  };

  const assertConversationOwner = async (conversationId, owner) => {
    const userId = typeof owner?.userId === 'string' || typeof owner?.userId === 'number' ? String(owner.userId).trim() : '';
    if (!userId) {
      const error = new Error('MEMORY_OWNER_REQUIRED');
      error.code = 'MEMORY_OWNER_REQUIRED';
      throw error;
    }
    const [rows] = await db.query(
      'SELECT id FROM app_conversations WHERE user_id = ? AND conversation_id = ? LIMIT 1',
      [userId, conversationId]
    );
    if (rows.length === 0) {
      const error = new Error('CONVERSATION_NOT_FOUND');
      error.code = 'CONVERSATION_NOT_FOUND';
      throw error;
    }
    return true;
  };

  const readMetadata = async (conversationId) => {
    const [rows] = await db.query(
      'SELECT * FROM conversation_documents WHERE conversation_id = ? LIMIT 1',
      [conversationId]
    );
    return rows[0] || null;
  };

  const upsertMetadata = async ({
    conversationId,
    version = 0,
    status = DEFAULT_STATUS,
    lastWriterStatus = null,
    lastWriterModel = null,
    lastWriterDurationMs = null,
    lastErrorCode = null
  }) => {
    const storageKey = makeStorageKey(conversationId);
    const ts = new Date();
    await db.query(
      `INSERT INTO conversation_documents
       (conversation_id, file_name, storage_key, version, status, last_writer_status, last_writer_model, last_writer_duration_ms, last_error_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         file_name = VALUES(file_name),
         storage_key = VALUES(storage_key),
         version = VALUES(version),
         status = VALUES(status),
         last_writer_status = VALUES(last_writer_status),
         last_writer_model = VALUES(last_writer_model),
         last_writer_duration_ms = VALUES(last_writer_duration_ms),
         last_error_code = VALUES(last_error_code),
         updated_at = VALUES(updated_at)`,
      [
        conversationId,
        storageKey,
        storageKey,
        version,
        status,
        lastWriterStatus,
        lastWriterModel,
        Number.isFinite(Number(lastWriterDurationMs)) ? Math.max(0, Math.round(Number(lastWriterDurationMs))) : null,
        lastErrorCode,
        ts,
        ts
      ]
    );
    return readMetadata(conversationId);
  };

  const recordUpdate = async ({
    conversationId,
    documentVersion,
    sourceUserMessageId = null,
    sourceAssistantMessageId = null,
    updateStatus,
    errorCode = null
  }) => {
    await db.query(
      `INSERT INTO conversation_document_updates
       (conversation_id, document_version, source_user_message_id, source_assistant_message_id, update_status, error_code, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        conversationId,
        Number.isFinite(Number(documentVersion)) ? Number(documentVersion) : 0,
        sourceUserMessageId ? String(sourceUserMessageId).slice(0, 191) : null,
        sourceAssistantMessageId ? String(sourceAssistantMessageId).slice(0, 191) : null,
        updateStatus,
        errorCode ? String(errorCode).slice(0, 100) : null,
        new Date()
      ]
    );
  };

  const createInitialForConversation = async (conversationId, owner = null) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!isValidConversationId(normalizedConversationId)) {
      const error = new Error('INVALID_CONVERSATION_ID');
      error.code = 'INVALID_CONVERSATION_ID';
      throw error;
    }
    await ensureStorageRoot();
    if (owner) {
      await assertConversationOwner(normalizedConversationId, owner);
    }
    const storageKey = makeStorageKey(normalizedConversationId);
    const filePath = resolveStoragePath(storageKey);
    const existingMetadata = await readMetadata(normalizedConversationId);
    if (existingMetadata && await fileStore.pathExists(filePath)) {
      return existingMetadata;
    }
    const content = makeInitialDocument(normalizedConversationId);
    await atomicWrite({
      conversationId: normalizedConversationId,
      content,
      maxDocumentChars: 20000,
      createBackup: false
    });
    return upsertMetadata({
      conversationId: normalizedConversationId,
      version: 0,
      status: DEFAULT_STATUS,
      lastWriterStatus: 'initialized'
    });
  };

  const readForConversation = async (conversationId, owner = null, options = {}) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!isValidConversationId(normalizedConversationId)) {
      const error = new Error('INVALID_CONVERSATION_ID');
      error.code = 'INVALID_CONVERSATION_ID';
      throw error;
    }
    await ensureStorageRoot();
    if (owner) {
      await assertConversationOwner(normalizedConversationId, owner);
    }

    let metadata = await readMetadata(normalizedConversationId);
    const storageKey = makeStorageKey(normalizedConversationId);
    const filePath = resolveStoragePath(storageKey);
    if (!metadata || !(await fileStore.pathExists(filePath))) {
      if (options.createIfMissing === false) {
        const error = new Error('MEMORY_DOCUMENT_NOT_FOUND');
        error.code = 'MEMORY_DOCUMENT_NOT_FOUND';
        throw error;
      }
      metadata = await createInitialForConversation(normalizedConversationId, owner);
    }

    try {
      const content = await fileStore.readFile(filePath, 'utf8');
      return {
        conversationId: normalizedConversationId,
        content,
        metadata,
        storageKey,
        filePath
      };
    } catch (error) {
      const backup = await readLatestBackup(normalizedConversationId);
      if (backup) {
        await upsertMetadata({
          conversationId: normalizedConversationId,
          version: metadata?.version || 0,
          status: 'recovered_from_backup',
          lastWriterStatus: 'read_recovered',
          lastErrorCode: error?.code || 'READ_FAILED'
        });
        return {
          conversationId: normalizedConversationId,
          content: backup.content,
          metadata,
          storageKey,
          filePath: backup.filePath
        };
      }
      logger.warn?.('[conversation-memory] read failed, using fresh initial document', {
        conversationId: normalizedConversationId,
        message: error instanceof Error ? error.message : String(error)
      });
      const content = makeInitialDocument(normalizedConversationId);
      return {
        conversationId: normalizedConversationId,
        content,
        metadata,
        storageKey,
        filePath
      };
    }
  };

  const listBackupPaths = async (conversationId) => {
    const files = await fileStore.readdir(root).catch(() => []);
    const escaped = conversationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}\\.memory\\.v(\\d+)\\.md$`);
    return files
      .map((fileName) => {
        const match = fileName.match(pattern);
        return match ? { fileName, version: Number(match[1]), filePath: path.join(root, fileName) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.version - a.version);
  };

  const readLatestBackup = async (conversationId) => {
    const backups = await listBackupPaths(conversationId);
    for (const backup of backups) {
      try {
        return {
          filePath: backup.filePath,
          content: await fileStore.readFile(backup.filePath, 'utf8')
        };
      } catch (_error) {
        // Try the next backup.
      }
    }
    return null;
  };

  async function rotateBackups(conversationId, currentVersion) {
    const storageKey = makeStorageKey(conversationId);
    const filePath = resolveStoragePath(storageKey);
    if (await fileStore.pathExists(filePath)) {
      const backupPath = path.join(root, `${conversationId}.memory.v${currentVersion}.md`);
      await fileStore.copy(filePath, backupPath, { overwrite: true });
    }

    const backups = await listBackupPaths(conversationId);
    for (const backup of backups.slice(maxBackupVersions)) {
      await fileStore.remove(backup.filePath).catch(() => undefined);
    }
  }

  async function atomicWrite({ conversationId, content, maxDocumentChars, createBackup = true, currentVersion = 0 }) {
    await ensureStorageRoot();
    const storageKey = makeStorageKey(conversationId);
    const filePath = resolveStoragePath(storageKey);
    const validated = validateMemoryDocument({ content, conversationId, maxDocumentChars });
    if (createBackup) {
      await rotateBackups(conversationId, currentVersion);
    }
    const tmpName = `${storageKey}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const tmpPath = path.join(root, tmpName);
    await fileStore.writeFile(tmpPath, validated, 'utf8');
    const stat = await fileStore.stat(tmpPath);
    if (!stat.isFile() || stat.size <= 0) {
      await fileStore.remove(tmpPath).catch(() => undefined);
      const error = new Error('MEMORY_TMP_WRITE_FAILED');
      error.code = 'MEMORY_TMP_WRITE_FAILED';
      throw error;
    }
    await fileStore.rename(tmpPath, filePath);
    return validated;
  }

  const saveUpdatedDocument = async ({
    conversationId,
    content,
    model = null,
    durationMs = null,
    sourceUserMessageId = null,
    sourceAssistantMessageId = null,
    maxDocumentChars = 20000
  }) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    const metadata = await readMetadata(normalizedConversationId);
    const nextVersion = Number(metadata?.version || 0) + 1;
    const validated = await atomicWrite({
      conversationId: normalizedConversationId,
      content,
      maxDocumentChars,
      createBackup: true,
      currentVersion: metadata?.version || 0
    });
    const updated = await upsertMetadata({
      conversationId: normalizedConversationId,
      version: nextVersion,
      status: DEFAULT_STATUS,
      lastWriterStatus: 'success',
      lastWriterModel: model,
      lastWriterDurationMs: durationMs,
      lastErrorCode: null
    });
    await recordUpdate({
      conversationId: normalizedConversationId,
      documentVersion: nextVersion,
      sourceUserMessageId,
      sourceAssistantMessageId,
      updateStatus: 'success'
    });
    return { content: validated, metadata: updated };
  };

  const markWriterFailed = async ({ conversationId, errorCode, model = null, durationMs = null, sourceUserMessageId = null, sourceAssistantMessageId = null }) => {
    const metadata = await readMetadata(conversationId);
    await upsertMetadata({
      conversationId,
      version: Number(metadata?.version || 0),
      status: metadata?.status || DEFAULT_STATUS,
      lastWriterStatus: 'failed',
      lastWriterModel: model,
      lastWriterDurationMs: durationMs,
      lastErrorCode: errorCode || 'MEMORY_WRITER_FAILED'
    });
    await recordUpdate({
      conversationId,
      documentVersion: Number(metadata?.version || 0),
      sourceUserMessageId,
      sourceAssistantMessageId,
      updateStatus: 'failed',
      errorCode: errorCode || 'MEMORY_WRITER_FAILED'
    });
  };

  const reset = async (conversationId, owner = null) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (owner) await assertConversationOwner(normalizedConversationId, owner);
    const content = makeInitialDocument(normalizedConversationId);
    await atomicWrite({
      conversationId: normalizedConversationId,
      content,
      maxDocumentChars: 20000,
      createBackup: true,
      currentVersion: (await readMetadata(normalizedConversationId))?.version || 0
    });
    return upsertMetadata({
      conversationId: normalizedConversationId,
      version: 0,
      status: 'reset',
      lastWriterStatus: 'reset'
    });
  };

  const removeForConversation = async (conversationId) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    const storageKey = makeStorageKey(normalizedConversationId);
    await fileStore.remove(resolveStoragePath(storageKey)).catch(() => undefined);
    const backups = await listBackupPaths(normalizedConversationId);
    await Promise.all(backups.map((backup) => fileStore.remove(backup.filePath).catch(() => undefined)));
    await db.query('DELETE FROM conversation_document_updates WHERE conversation_id = ?', [normalizedConversationId]);
    await db.query('DELETE FROM conversation_documents WHERE conversation_id = ?', [normalizedConversationId]);
  };

  const rebuildFromMessages = async ({ conversationId, messages = [] }) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    const lines = [];
    const safeMessages = Array.isArray(messages) ? messages.slice(-80) : [];
    const last = safeMessages[safeMessages.length - 1];
    const firstUser = safeMessages.find((message) => message.role === 'user');
    lines.push(`# Conversation Document

## Conversation ID
${normalizedConversationId}

## Conversation Objective
${firstUser?.content ? firstUser.content.slice(0, 500) : 'از history قدیمی بازسازی شده و هدف دقیق هنوز قطعی نیست.'}

## Current Topic
از history ذخیره‌شده بازسازی شده است.

## User Requirements
${safeMessages.filter((message) => message.role === 'user').slice(-10).map((message) => `- ${String(message.content || '').slice(0, 500)}`).join('\n') || '- موردی ثبت نشده است.'}

## Confirmed Facts
- این Document از پیام‌های ذخیره‌شده دیتابیس بازسازی شده است.

## Decisions Made
- موردی وجود ندارد.

## Corrections
- موردی وجود ندارد.

## Completed Work
${safeMessages.filter((message) => message.role === 'assistant').slice(-10).map((message) => `- ${String(message.content || '').slice(0, 500)}`).join('\n') || '- موردی وجود ندارد.'}

## Current State
آخرین وضعیت از آخرین پیام‌های ذخیره‌شده استخراج شده است.

## Open Tasks
- بازبینی دقیق‌تر توسط Memory Writer در پیام بعدی انجام می‌شود.

## Active References
- موردی وجود ندارد.

## Important Entities
- conversationId: ${normalizedConversationId}

## User Preferences
- موردی وجود ندارد.

## Last Exchange
${last ? `${last.role}: ${String(last.content || '').slice(0, 800)}` : 'مکالمه پیام ذخیره‌شده ندارد.'}

## Critical Details That Must Not Be Forgotten
- این Document نتیجه rebuild از history قدیمی است و ممکن است نیاز به تکمیل داشته باشد.

## Uncertainties
- جزئیات قطعی نشده از history قدیمی ممکن است کامل نباشد.

## Updated At
${nowIso()}
`);
    const content = lines.join('\n');
    await atomicWrite({
      conversationId: normalizedConversationId,
      content,
      maxDocumentChars: 20000,
      createBackup: true,
      currentVersion: (await readMetadata(normalizedConversationId))?.version || 0
    });
    return upsertMetadata({
      conversationId: normalizedConversationId,
      version: 0,
      status: 'rebuilt',
      lastWriterStatus: 'rebuilt'
    });
  };

  const getAdminView = async (conversationId) => {
    const normalizedConversationId = normalizeConversationId(conversationId);
    const doc = await readForConversation(normalizedConversationId, null);
    const stat = await fileStore.stat(resolveStoragePath(makeStorageKey(normalizedConversationId))).catch(() => null);
    return {
      conversationId: normalizedConversationId,
      metadata: doc.metadata,
      storageKey: doc.storageKey,
      sizeBytes: stat?.size || Buffer.byteLength(doc.content || '', 'utf8'),
      content: doc.content
    };
  };

  return {
    ensureMetadataTables,
    ensureStorageRoot,
    generateConversationId: uuidv4,
    isValidConversationId,
    makeInitialDocument,
    makeStorageKey,
    createInitialForConversation,
    readForConversation,
    saveUpdatedDocument,
    markWriterFailed,
    reset,
    removeForConversation,
    rebuildFromMessages,
    getAdminView,
    validateMemoryDocument
  };
}

module.exports = {
  createConversationMemoryService,
  isValidConversationId,
  makeInitialDocument,
  validateMemoryDocument
};
