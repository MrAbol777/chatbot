const path = require('path');

function createAdminSystemService({
  ensureConfigData,
  fileStore,
  configFilePath,
  systemPromptFilePath,
  appendAudit,
  isSystemPromptEditEnabled,
  onSystemPromptUpdated,
  defaultConfig,
  readJson,
  writeJson
}) {
  const getConfig = async () => ensureConfigData();

  const updateConfig = async ({ body, admin }) => {
    const current = await ensureConfigData();
    const nextConfig = {
      model: typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : current.model,
      timeoutMs: Number.isFinite(Number(body?.timeoutMs)) ? Number(body.timeoutMs) : current.timeoutMs,
      features: {
        voiceInput: Boolean(body?.features?.voiceInput),
        quickChips: Boolean(body?.features?.quickChips),
        practiceMode: Boolean(body?.features?.practiceMode)
      }
    };

    await writeJson(configFilePath, nextConfig, { spaces: 2 });
    await appendAudit({
      adminUsername: admin?.username,
      action: 'update_config',
      target: 'config',
      details: {
        modelBefore: current.model,
        modelAfter: nextConfig.model,
        timeoutMsBefore: current.timeoutMs,
        timeoutMsAfter: nextConfig.timeoutMs
      }
    });

    if (current.model !== nextConfig.model) {
      await appendAudit({
        adminUsername: admin?.username,
        action: 'change_model',
        target: 'model',
        details: { from: current.model, to: nextConfig.model }
      });
    }

    return { success: true, config: nextConfig };
  };

  const getSystemPrompt = async () => {
    if (!isSystemPromptEditEnabled()) {
      return { statusCode: 403, body: { error: 'ویرایش سیستم پرامپت غیرفعال است.' } };
    }
    const config = await ensureConfigData();
    return { statusCode: 200, body: { systemPrompt: config.systemPrompt || '' } };
  };

    const promptHistoryFilePath = path.join(path.dirname(systemPromptFilePath), 'data', 'system-prompt-history.json');

    const ensurePromptHistory = async () => {
      try {
        await fileStore.ensureFile(promptHistoryFilePath);
        const raw = await fileStore.readFile(promptHistoryFilePath, 'utf8');
        if (!raw.trim()) {
          const initial = [];
          await fileStore.writeJson(promptHistoryFilePath, initial, { spaces: 2 });
          return initial;
        }
        return JSON.parse(raw);
      } catch (_err) {
        return [];
      }
    };

    const getPromptHistory = async () => {
      const history = await ensurePromptHistory();
      return {
        statusCode: 200,
        body: {
          items: history.map((item) => ({
            id: item.id,
            version: item.version,
            author: item.author || 'admin',
            createdAt: item.createdAt,
            note: item.note || '',
            length: (item.prompt || '').length,
            preview: (item.prompt || '').slice(0, 120),
            prompt: item.prompt || ''
          }))
        }
      };
    };

    const updateSystemPrompt = async ({ body, admin }) => {
      if (!isSystemPromptEditEnabled()) {
        return { statusCode: 403, body: { error: 'ویرایش سیستم پرامپت غیرفعال است.' } };
      }

      const nextPrompt = typeof body?.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
      if (!nextPrompt) {
        return { statusCode: 400, body: { error: 'متن سیستم پرامپت نمی تواند خالی باشد.' } };
      }

      const current = await ensureConfigData();
      await fileStore.writeFile(systemPromptFilePath, `${nextPrompt}\n`, 'utf8');

      // Save version to history
      const history = await ensurePromptHistory();
      const nextVersion = (history.length > 0 ? (history[0].version || history.length) : 0) + 1;
      const historyEntry = {
        id: `v-${Date.now()}`,
        version: nextVersion,
        prompt: nextPrompt,
        author: admin?.username || 'admin',
        note: typeof body?.note === 'string' ? body.note.trim() : 'ویرایش دستی سیستم پرامپت',
        createdAt: new Date().toISOString()
      };
      // Keep most recent first, max 30 versions
      const updatedHistory = [historyEntry, ...history].slice(0, 30);
      try {
        await fileStore.writeJson(promptHistoryFilePath, updatedHistory, { spaces: 2 });
      } catch (_e) { /* ignore history file write error */ }

      if (typeof onSystemPromptUpdated === 'function') {
        onSystemPromptUpdated();
      }

      await appendAudit({
        adminUsername: admin?.username,
        action: 'update_system_prompt',
        target: 'system_prompt',
        details: {
          version: nextVersion,
          previousLength: (current.systemPrompt || '').length,
          nextLength: nextPrompt.length
        }
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          message: 'پرامپت با موفقیت به‌روزرسانی شد',
          version: nextVersion
        }
      };
    };

    const rollbackPrompt = async ({ body, admin }) => {
      if (!isSystemPromptEditEnabled()) {
        return { statusCode: 403, body: { error: 'ویرایش سیستم پرامپت غیرفعال است.' } };
      }
      const versionId = String(body?.versionId || '').trim();
      if (!versionId) {
        return { statusCode: 400, body: { error: 'شناسه نسخه الزامی است.' } };
      }
      const history = await ensurePromptHistory();
      const target = history.find((h) => h.id === versionId || String(h.version) === versionId);
      if (!target || !target.prompt) {
        return { statusCode: 404, body: { error: 'نسخه مورد نظر پیدا نشد.' } };
      }

      await fileStore.writeFile(systemPromptFilePath, `${target.prompt}\n`, 'utf8');

      if (typeof onSystemPromptUpdated === 'function') {
        onSystemPromptUpdated();
      }

      await appendAudit({
        adminUsername: admin?.username,
        action: 'rollback_system_prompt',
        target: 'system_prompt',
        details: {
          rolledBackToId: target.id,
          rolledBackToVersion: target.version
        }
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          message: `پرامپت به نسخه ${target.version} بازگردانی شد.`,
          systemPrompt: target.prompt
        }
      };
    };

  return {
    getConfig,
    updateConfig,
    getSystemPrompt,
    updateSystemPrompt,
    getPromptHistory,
    rollbackPrompt
  };
}

module.exports = { createAdminSystemService };
