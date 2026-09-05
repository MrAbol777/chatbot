'use strict';

const path = require('path');
const fs = require('fs-extra');
const mysql = require('mysql2/promise');

const IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^[1-9]\d*$|^0$/i;

const normalizeImageId = (value) => {
  const imageId = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return IMAGE_ID_PATTERN.test(imageId) ? imageId : '';
};

const normalizeUserId = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const defaultUploadsRoot = path.resolve(__dirname, '../../../uploads');
let defaultRepository = null;

function createUploadOwnershipRepository({
  db = null,
  rootDirectory = defaultUploadsRoot,
  databaseUrl = process.env.DATABASE_URL || ''
} = {}) {
  const ownersDirectory = path.join(path.resolve(rootDirectory), '.owners');

  const ensureStore = async () => {
    await fs.ensureDir(ownersDirectory);
  };

  const ownerPathFor = (imageId) => path.join(ownersDirectory, `${imageId}.json`);

  const readStoredOwner = async (imageId) => {
    await ensureStore();
    try {
      const payload = await fs.readJson(ownerPathFor(imageId));
      return normalizeUserId(payload?.userId);
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      return '';
    }
  };

  const register = async ({ imageId, userId }) => {
    const normalizedImageId = normalizeImageId(imageId);
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedImageId || !normalizedUserId) {
      throw new Error('Valid imageId and userId are required for upload ownership');
    }

    await ensureStore();
    const target = ownerPathFor(normalizedImageId);
    const existing = await readStoredOwner(normalizedImageId);
    if (existing) {
      if (existing !== normalizedUserId) {
        const error = new Error('Upload ownership conflict');
        error.code = 'UPLOAD_OWNER_CONFLICT';
        throw error;
      }
      return { imageId: normalizedImageId, userId: normalizedUserId };
    }

    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(temporary, { userId: normalizedUserId }, { mode: 0o600 });
    try {
      // rename is atomic on the same filesystem. If another request won the
      // race, verify that it recorded the same owner before accepting it.
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.remove(temporary).catch(() => undefined);
      const racedOwner = await readStoredOwner(normalizedImageId);
      if (racedOwner === normalizedUserId) {
        return { imageId: normalizedImageId, userId: normalizedUserId };
      }
      throw error;
    }
    await fs.chmod(target, 0o600).catch(() => undefined);
    return { imageId: normalizedImageId, userId: normalizedUserId };
  };

  const registerMany = async ({ imageIds, userId }) => {
    const ids = [...new Set((Array.isArray(imageIds) ? imageIds : []).map(normalizeImageId).filter(Boolean))];
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || ids.length === 0) return [];
    const results = [];
    for (const imageId of ids) results.push(await register({ imageId, userId: normalizedUserId }));
    return results;
  };

  const queryLegacyOwner = async (imageId) => {
    const pluralNeedle = `%/api/uploads/images/${imageId}%`;
    const singularNeedle = `%/api/upload/images/${imageId}%`;
    const sql = `SELECT DISTINCT user_id
                 FROM app_conversations
                 WHERE CAST(messages AS CHAR) LIKE ? OR CAST(messages AS CHAR) LIKE ?
                 LIMIT 2`;

    let temporaryConnection = null;
    try {
      let executor = db;
      if (!executor?.query) {
        const url = String(databaseUrl || '').trim();
        if (!url) return '';
        temporaryConnection = await mysql.createConnection(url);
        executor = temporaryConnection;
      } else if (typeof executor.init === 'function') {
        await executor.init();
      }
      const [rows] = await executor.query(sql, [pluralNeedle, singularNeedle]);
      const owners = [...new Set((Array.isArray(rows) ? rows : []).map((row) => normalizeUserId(row.user_id)).filter(Boolean))];
      return owners.length === 1 ? owners[0] : '';
    } catch {
      // Legacy lookup must fail closed. A DB outage must never turn an unknown
      // upload into a public object.
      return '';
    } finally {
      await temporaryConnection?.end?.().catch(() => undefined);
    }
  };

  const resolveOwner = async (rawImageId) => {
    const imageId = normalizeImageId(rawImageId);
    if (!imageId) return '';
    const stored = await readStoredOwner(imageId);
    if (stored) return stored;

    const legacyOwner = await queryLegacyOwner(imageId);
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
    ensureStore,
    register,
    registerMany,
    resolveOwner,
    isOwnedBy,
    areOwnedBy,
    normalizeImageId,
    ownersDirectory
  };
}

function getDefaultUploadOwnershipRepository() {
  if (!defaultRepository) defaultRepository = createUploadOwnershipRepository();
  return defaultRepository;
}

module.exports = {
  createUploadOwnershipRepository,
  getDefaultUploadOwnershipRepository,
  normalizeImageId,
  IMAGE_ID_PATTERN
};
