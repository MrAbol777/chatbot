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

    if (typeof onSystemPromptUpdated === 'function') {
      onSystemPromptUpdated();
    }

    await appendAudit({
      adminUsername: admin?.username,
      action: 'update_system_prompt',
      target: 'system_prompt',
      details: {
        previousLength: (current.systemPrompt || '').length,
        nextLength: nextPrompt.length
      }
    });

    return { statusCode: 200, body: { success: true, message: 'پرامپت با موفقیت به‌روزرسانی شد' } };
  };

  return {
    getConfig,
    updateConfig,
    getSystemPrompt,
    updateSystemPrompt
  };
}

module.exports = { createAdminSystemService };
