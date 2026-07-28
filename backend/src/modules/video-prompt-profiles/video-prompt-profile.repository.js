'use strict';

const { randomUUID } = require('crypto');
const { normalizeText, profileChecksum } = require('./video-prompt-compiler');

const parseJson = (value, fallback = {}) => { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '')) || fallback; } catch (_) { return fallback; } };
const profileDto = (row, { includePrompt = false } = {}) => ({
  id: row.id,
  profileKey: row.profile_key,
  displayName: row.display_name,
  publicDescription: row.public_description,
  visualKey: row.visual_key,
  active: Boolean(row.is_active),
  public: Boolean(row.is_public),
  displayOrder: Number(row.display_order),
  currentVersionId: row.current_version_id,
  currentVersion: row.prompt_version == null ? null : Number(row.prompt_version),
  checksum: row.checksum || null,
  version: Number(row.profile_metadata_version ?? row.version),
  updatedAt: row.updated_at,
  ...(includePrompt ? {
    baseSystemPrompt: row.base_system_prompt,
    executionTemplate: row.execution_template,
    rulesManifest: parseJson(row.rules_manifest_json, {})
  } : {})
});
const versionDto = (row, { includePrompt = true } = {}) => ({
  id: row.id,
  profileId: row.profile_id,
  version: Number(row.version),
  checksum: row.checksum,
  createdByAdminId: row.created_by_admin_id,
  changeReason: row.change_reason,
  createdAt: row.created_at,
  jobCount: Number(row.job_count || 0),
  ...(includePrompt ? { baseSystemPrompt: row.base_system_prompt, executionTemplate: row.execution_template, rulesManifest: parseJson(row.rules_manifest_json, {}) } : {})
});
const adminError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

function createVideoPromptProfileRepository(db) {
  const currentSelect = `SELECT p.*,p.version AS profile_metadata_version,v.version AS prompt_version,v.base_system_prompt,v.execution_template,v.rules_manifest_json,v.checksum
    FROM app_video_prompt_profiles p LEFT JOIN app_video_prompt_profile_versions v ON v.id=p.current_version_id`;
  return {
    listPublic: async () => {
      const [rows] = await db.query(`${currentSelect} WHERE p.is_active=1 AND p.is_public=1 AND p.current_version_id IS NOT NULL ORDER BY p.display_order,p.profile_key`);
      return rows.map((row) => profileDto(row));
    },
    getCurrentByKey: async (profileKey, { publicOnly = true } = {}) => {
      const [rows] = await db.query(`${currentSelect} WHERE p.profile_key=? ${publicOnly ? 'AND p.is_active=1 AND p.is_public=1' : ''} LIMIT 1`, [profileKey]);
      return rows[0] || null;
    },
    listAdmin: async () => {
      const [rows] = await db.query(`${currentSelect} ORDER BY p.display_order,p.profile_key`);
      return rows.map((row) => profileDto(row, { includePrompt: true }));
    },
    getAdmin: async (profileKey) => {
      const [rows] = await db.query(`${currentSelect} WHERE p.profile_key=? LIMIT 1`, [profileKey]);
      return rows[0] ? profileDto(rows[0], { includePrompt: true }) : null;
    },
    listVersions: async (profileKey) => {
      const [rows] = await db.query(`SELECT v.*,(SELECT COUNT(*) FROM app_video_generations g WHERE g.prompt_profile_version_id=v.id) AS job_count FROM app_video_prompt_profile_versions v JOIN app_video_prompt_profiles p ON p.id=v.profile_id WHERE p.profile_key=? ORDER BY v.version DESC`, [profileKey]);
      return rows.map((row) => versionDto(row));
    },
    listAudit: async (profileKey = null) => {
      const params = []; const where = profileKey ? 'WHERE p.profile_key=?' : ''; if (profileKey) params.push(profileKey);
      const [rows] = await db.query(`SELECT a.*,p.profile_key FROM app_video_prompt_profile_audit_logs a JOIN app_video_prompt_profiles p ON p.id=a.profile_id ${where} ORDER BY a.id DESC LIMIT 200`, params);
      return rows.map((row) => ({ id: Number(row.id), profileKey: row.profile_key, profileVersionId: row.profile_version_id, action: row.action, changedBy: row.changed_by, reason: row.reason, previous: parseJson(row.previous_metadata, null), next: parseJson(row.new_metadata, null), createdAt: row.created_at }));
    },
    updateMetadata: async ({ profileKey, expectedVersion, reason, adminId, changes }) => {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT * FROM app_video_prompt_profiles WHERE profile_key=? FOR UPDATE', [profileKey]); const current = rows[0];
        if (!current) throw adminError('VIDEO_PROMPT_PROFILE_NOT_FOUND', 'پروفایل پیدا نشد.', 404);
        if (Number(current.version) !== Number(expectedVersion)) throw adminError('VIDEO_PROMPT_PROFILE_VERSION_CONFLICT', 'نسخه پروفایل تغییر کرده است.', 409);
        const next = {
          displayName: changes.displayName === undefined ? current.display_name : normalizeText(changes.displayName),
          publicDescription: changes.publicDescription === undefined ? current.public_description : normalizeText(changes.publicDescription),
          visualKey: changes.visualKey === undefined ? current.visual_key : normalizeText(changes.visualKey),
          active: changes.active === undefined ? Boolean(current.is_active) : Boolean(changes.active),
          public: changes.public === undefined ? Boolean(current.is_public) : Boolean(changes.public),
          displayOrder: changes.displayOrder === undefined ? Number(current.display_order) : Number(changes.displayOrder)
        };
        if (!next.displayName || next.displayName.length > 191 || !next.publicDescription || next.publicDescription.length > 500 || !/^[a-z0-9_-]{2,64}$/i.test(next.visualKey) || !Number.isSafeInteger(next.displayOrder)) throw adminError('VIDEO_PROMPT_PROFILE_METADATA_INVALID', 'اطلاعات عمومی پروفایل معتبر نیست.');
        await connection.query('UPDATE app_video_prompt_profiles SET display_name=?,public_description=?,visual_key=?,is_active=?,is_public=?,display_order=?,version=version+1,updated_at=NOW() WHERE id=? AND version=?', [next.displayName,next.publicDescription,next.visualKey,Number(next.active),Number(next.public),next.displayOrder,current.id,expectedVersion]);
        await connection.query('INSERT INTO app_video_prompt_profile_audit_logs (profile_id,profile_version_id,action,changed_by,reason,previous_metadata,new_metadata,created_at) VALUES (?,NULL,?,?,?,?,?,NOW())', [current.id,'metadata_updated',String(adminId || 'admin').slice(0,191),reason,JSON.stringify({ displayName:current.display_name,publicDescription:current.public_description,visualKey:current.visual_key,active:Boolean(current.is_active),public:Boolean(current.is_public),displayOrder:Number(current.display_order) }),JSON.stringify(next)]);
        await connection.commit(); return { version: Number(expectedVersion) + 1 };
      } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; } finally { connection.release(); }
    },
    createVersion: async ({ profileKey, expectedVersion, baseSystemPrompt, executionTemplate, rulesManifest, reason, adminId }) => {
      const base = normalizeText(baseSystemPrompt); const template = normalizeText(executionTemplate);
      if (!base || !template || !rulesManifest || typeof rulesManifest !== 'object') throw adminError('VIDEO_PROMPT_PROFILE_VERSION_INVALID', 'محتوای نسخه کامل نیست.');
      const checksum = profileChecksum({ baseSystemPrompt: base, executionTemplate: template, rulesManifest });
      const connection = await db.getConnection(); const versionId = randomUUID();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT * FROM app_video_prompt_profiles WHERE profile_key=? FOR UPDATE', [profileKey]); const current = rows[0];
        if (!current) throw adminError('VIDEO_PROMPT_PROFILE_NOT_FOUND', 'پروفایل پیدا نشد.', 404);
        if (Number(current.version) !== Number(expectedVersion)) throw adminError('VIDEO_PROMPT_PROFILE_VERSION_CONFLICT', 'نسخه پروفایل تغییر کرده است.', 409);
        const [versionRows] = await connection.query('SELECT COALESCE(MAX(version),0)+1 AS next_version FROM app_video_prompt_profile_versions WHERE profile_id=?', [current.id]); const nextVersion = Number(versionRows[0].next_version);
        await connection.query('INSERT INTO app_video_prompt_profile_versions (id,profile_id,version,base_system_prompt,execution_template,rules_manifest_json,checksum,created_by_admin_id,change_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,NOW())', [versionId,current.id,nextVersion,base,template,JSON.stringify(rulesManifest),checksum,String(adminId || 'admin').slice(0,191),reason]);
        await connection.query('UPDATE app_video_prompt_profiles SET current_version_id=?,version=version+1,updated_at=NOW() WHERE id=? AND version=?', [versionId,current.id,expectedVersion]);
        await connection.query('INSERT INTO app_video_prompt_profile_audit_logs (profile_id,profile_version_id,action,changed_by,reason,previous_metadata,new_metadata,created_at) VALUES (?,?,?,?,?,?,?,NOW())', [current.id,versionId,'version_created',String(adminId || 'admin').slice(0,191),reason,JSON.stringify({ currentVersionId:current.current_version_id }),JSON.stringify({ currentVersionId:versionId,version:nextVersion,checksum })]);
        await connection.commit(); return { id: versionId, version: nextVersion, checksum, profileMetadataVersion: Number(expectedVersion) + 1 };
      } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; } finally { connection.release(); }
    }
  };
}

module.exports = { createVideoPromptProfileRepository, profileDto, versionDto };
