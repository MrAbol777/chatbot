function createConversationsController({ conversationsService }) {
  const load = async (req, res) => {
    try {
      const result = await conversationsService.loadConversations({
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
      const result = await conversationsService.syncConversations({
        profile: req.body?.profile,
        items: req.body?.items
      });
      return res.json(result);
    } catch (error) {
      await conversationsService.logSyncError(error);
      return res.status(500).json({ error: 'ذخیره گفتگوها با خطا مواجه شد.' });
    }
  };

  return {
    load,
    sync
  };
}

module.exports = { createConversationsController };
