function createConversationsController({ conversationsService, resolveOwner }) {
  const requireOwner = async (req, res) => {
    const owner = await resolveOwner(req, res);
    if (owner?.error) {
      const status = String(owner.error).startsWith('CSRF_') ? 403 : 401;
      res.status(status).json({ error: owner.error });
      return null;
    }
    if (!owner?.userId) {
      res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
      return null;
    }
    return owner;
  };

  const create = async (req, res) => {
    try {
      const owner = await requireOwner(req, res);
      if (!owner) return undefined;
      const result = await conversationsService.createConversation({
        userId: owner.userId,
        profile: req.body?.profile
      });
      return res.status(201).json(result);
    } catch (error) {
      await conversationsService.logSyncError(error);
      return res.status(500).json({ error: 'ساخت گفتگوی جدید با خطا مواجه شد.' });
    }
  };

  const load = async (req, res) => {
    try {
      const owner = await requireOwner(req, res);
      if (!owner) return undefined;
      const result = await conversationsService.loadConversations({
        userId: owner.userId,
        profile: req.body?.profile
      });
      return res.json(result);
    } catch (error) {
      await conversationsService.logLoadError(error);
      return res.status(500).json({ error: 'بارگذاری گفتگوها با خطا مواجه شد.' });
    }
  };

  const sync = async (req, res) => {
    try {
      const owner = await requireOwner(req, res);
      if (!owner) return undefined;
      const result = await conversationsService.syncConversations({
        userId: owner.userId,
        profile: req.body?.profile,
        items: req.body?.items
      });
      return res.json(result);
    } catch (error) {
      await conversationsService.logSyncError(error);
      return res.status(500).json({ error: 'ذخیره گفتگوها با خطا مواجه شد.' });
    }
  };

  const updateTitle = async (req, res) => {
    try {
      const owner = await requireOwner(req, res);
      if (!owner) return undefined;
      const result = await conversationsService.updateManualTitle({
        userId: owner.userId,
        conversationId: req.params?.conversationId,
        title: req.body?.title
      });
      return res.json(result);
    } catch (error) {
      if (error?.code === 'TITLE_REQUIRED' || error?.code === 'TITLE_TOO_LONG') {
        return res.status(400).json({ error: error.code });
      }
      if (error?.code === 'CONVERSATION_FORBIDDEN') return res.status(403).json({ error: error.code });
      if (error?.code === 'CONVERSATION_NOT_FOUND') return res.status(404).json({ error: error.code });
      return res.status(500).json({ error: 'ویرایش عنوان با خطا مواجه شد.' });
    }
  };

  return {
    create,
    load,
    sync,
    updateTitle
  };
}

module.exports = { createConversationsController };
