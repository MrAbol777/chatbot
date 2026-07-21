function createConversationsService({ usersRepository, conversationsRepository, errorsRepository, now = () => new Date().toISOString() }) {
  const loadConversations = async ({ profile }) => {
    const safeProfile = profile || {};
    const userId = await usersRepository.ensureUserExists(safeProfile);
    const items = await conversationsRepository.getUserConversations(userId);

    return {
      success: true,
      userId,
      items
    };
  };

  const syncConversations = async ({ profile, items }) => {
    const safeProfile = profile || {};
    const rawItems = Array.isArray(items) ? items : [];
    const userId = await usersRepository.ensureUserExists(safeProfile);

    const normalizedItems = rawItems.map((item) => ({
      conversation_id: typeof item?.id === 'string' ? item.id : String(item?.id || 'default'),
      title: typeof item?.title === 'string' ? item.title : '',
      pinned: Boolean(item?.pinned),
      created_at: item?.createdAt || now(),
      updated_at: item?.updatedAt || item?.createdAt || now(),
      messages: Array.isArray(item?.messages)
        ? item.messages.map((msg) => ({
            id: typeof msg?.id === 'string' ? msg.id : undefined,
            role: msg?.role,
            type: typeof msg?.type === 'string' ? msg.type : undefined,
            intent: typeof msg?.intent === 'string' ? msg.intent : undefined,
            content: msg?.content,
            timestamp: msg?.timestamp,
            taskId: typeof msg?.taskId === 'string' || typeof msg?.taskId === 'number' ? String(msg.taskId) : undefined,
            status: typeof msg?.status === 'string' ? msg.status : undefined,
            images: Array.isArray(msg?.images)
              ? msg.images
                  .filter((image) => image && typeof image.url === 'string' && image.url.trim())
                  .slice(0, 5)
                  .map((image) => ({
                    url: image.url.trim(),
                    alt: typeof image.alt === 'string' ? image.alt.trim() : ''
                  }))
              : undefined
          }))
        : []
    }));

    const savedCount = await conversationsRepository.replaceUserConversations(userId, normalizedItems);
    return { success: true, savedCount };
  };

  const logLoadError = async (error) => {
    await errorsRepository.logError(
      'load_conversations_failed',
      '/api/conversations/load',
      500,
      error instanceof Error ? error.message : 'unknown'
    );
  };

  const logSyncError = async (error) => {
    await errorsRepository.logError(
      'sync_conversations_failed',
      '/api/conversations/sync',
      500,
      error instanceof Error ? error.message : 'unknown'
    );
  };

  return {
    loadConversations,
    syncConversations,
    logLoadError,
    logSyncError
  };
}

module.exports = { createConversationsService };
