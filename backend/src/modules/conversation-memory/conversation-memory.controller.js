function createConversationMemoryController({
  conversationMemoryService,
  conversationsRepository,
  chatMessagesRepository = null
}) {
  const getMemory = async (req, res) => {
    try {
      const view = await conversationMemoryService.getAdminView(req.params.conversationId);
      return res.json(view);
    } catch (error) {
      const status = error?.code === 'INVALID_CONVERSATION_ID' ? 400 : 404;
      return res.status(status).json({ error: error?.code || 'MEMORY_NOT_FOUND' });
    }
  };

  const resetMemory = async (req, res) => {
    try {
      const metadata = await conversationMemoryService.reset(req.params.conversationId);
      return res.json({ success: true, metadata });
    } catch (error) {
      const status = error?.code === 'INVALID_CONVERSATION_ID' ? 400 : 500;
      return res.status(status).json({ error: error?.code || 'MEMORY_RESET_FAILED' });
    }
  };

  const rebuildMemory = async (req, res) => {
    try {
      const conversationId = String(req.params.conversationId || '').trim();
      let messages = [];
      if (chatMessagesRepository && typeof chatMessagesRepository.listConversationMessages === 'function') {
        messages = await chatMessagesRepository.listConversationMessages({ conversationId, limit: 200 });
      } else if (conversationsRepository && typeof conversationsRepository.getAnyConversationMessages === 'function') {
        messages = await conversationsRepository.getAnyConversationMessages(conversationId);
      }
      const metadata = await conversationMemoryService.rebuildFromMessages({ conversationId, messages });
      return res.json({ success: true, metadata, messageCount: messages.length });
    } catch (error) {
      const status = error?.code === 'INVALID_CONVERSATION_ID' ? 400 : 500;
      return res.status(status).json({ error: error?.code || 'MEMORY_REBUILD_FAILED' });
    }
  };

  const downloadMemory = async (req, res) => {
    try {
      const view = await conversationMemoryService.getAdminView(req.params.conversationId);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(view.storageKey)}"`);
      return res.send(view.content);
    } catch (error) {
      return res.status(404).json({ error: error?.code || 'MEMORY_NOT_FOUND' });
    }
  };

  return {
    getMemory,
    resetMemory,
    rebuildMemory,
    downloadMemory
  };
}

module.exports = { createConversationMemoryController };
