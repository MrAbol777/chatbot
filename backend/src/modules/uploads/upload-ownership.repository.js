'use strict';

const IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^[1-9]\d*$|^0$/i;

const normalizeImageId = (value) => {
  const imageId = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return IMAGE_ID_PATTERN.test(imageId) ? imageId : '';
};

const normalizeUserId = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

function createUploadOwnershipRepository(db) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('Upload ownership repository requires a database');
  }

  let schemaPromise = null;
  const ensureSchema = async () => {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      if (typeof db.init === 'function') await db.init();
      await db.query(`
        CREATE TABLE IF NOT EXISTS app_uploaded_image_owners (
          image_id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(191) NOT NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_uploaded_image_owner_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
    })();
    return schemaPromise;
  };

  const register = async ({ imageId, userId, createdAt = new Date() }) => {
    const normalizedImageId = normalizeImageId(imageId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedImageId || !normalizedUserId) {
      throw new Error('Valid imageId and userId are required for upload ownership');
    }
    await ensureSchema();
    await db.query(
      `INSERT INTO app_uploaded_image_owners (image_id, user_id, created_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [normalizedImageId, normalizedUserId, createdAt]
    );
    return { imageId: normalizedImageId, userId: normalizedUserId };
  };

  const registerMany = async ({ imageIds, userId, createdAt = new Date() }) => {
    const normalizedUserId = normalizeUserId(userId);
    const ids = [...new Set((Array.isArray(imageIds) ? imageIds : []).map(normalizeImageId).filter(Boolean))];
    if (!normalizedUserId || ids.length === 0) return [];
    await ensureSchema();

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : null;
    const executor = connection || db;
    try {
      if (connection) await connection.beginTransaction();
      for (const imageId of ids) {
        await executor.query(
          `INSERT INTO app_uploaded_image_owners (image_id, user_id, created_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE user_id = user_id`,
          [imageId, normalizedUserId, createdAt]
        );
      }
      if (connection) await connection.commit();
      return ids.map((imageId) => ({ imageId, userId: normalizedUserId }));
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      connection?.release?.();
    }
  };

  const findPersistedOwner = async (imageId) => {
    await ensureSchema();
    const [rows] = await db.query(
      'SELECT user_id FROM app_uploaded_image_owners WHERE image_id = ? LIMIT 1',
      [imageId]
    );
    return normalizeUserId(rows?.[0]?.user_id);
  };

  const findLegacyOwner = async (imageId) => {
    // Older uploads predate ownership metadata. Conversation JSON already stores
    // their same-origin URL together with the owning app_conversations.user_id.
    // Resolve only an unambiguous single owner, then persist it for future reads.
    const pluralNeedle = `%/api/uploads/images/${imageId}%`;
    const singularNeedle = `%/api/upload/images/${imageId}%`;
    const [rows] = await db.query(
      `SELECT DISTINCT user_id
       FROM app_conversations
       WHERE CAST(messages AS CHAR) LIKE ? OR CAST(messages AS CHAR) LIKE ?
       LIMIT 2`,
      [pluralNeedle, singularNeedle]
    );
    const owners = [...new Set((Array.isArray(rows) ? rows : []).map((row) => normalizeUserId(row.user_id)).filter(Boolean))];
    return owners.length === 1 ? owners[0] : '';
  };

  const resolveOwner = async (rawImageId) => {
    const imageId = normalizeImageId(rawImageId);
    if (!imageId) return '';

    const persisted = await findPersistedOwner(imageId);
    if (persisted) return persisted;

    const legacyOwner = await findLegacyOwner(imageId);
    if (!legacyOwner) return '';
    await register({ imageId, userId: legacyOwner });
    return legacyOwner;
  };

  const isOwnedBy = async (imageId, userId) => {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return false;
    return (await resolveOwner(imageId)) === normalizedUserId;
  };

  const areOwnedBy = async (imageIds, userId) => {
    const normalizedUserId = normalizeUserId(userId);
    const ids = [...new Set((Array.isArray(imageIds) ? imageIds : []).map(normalizeImageId).filter(Boolean))];
    if (!normalizedUserId) return false;
    if (ids.length === 0) return true;
    for (const imageId of ids) {
      if ((await resolveOwner(imageId)) !== normalizedUserId) return false;
    }
    return true;
  };

  return {
    ensureSchema,
    register,
    registerMany,
    resolveOwner,
    isOwnedBy,
    areOwnedBy,
    normalizeImageId
  };
}

module.exports = { createUploadOwnershipRepository, normalizeImageId, IMAGE_ID_PATTERN };
