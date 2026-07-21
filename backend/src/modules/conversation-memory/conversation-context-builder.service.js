function createConversationContextBuilder({ conversationMemoryService }) {
  const buildModelContext = async ({
    conversationId,
    userMessage,
    systemPrompt,
    owner
  }) => {
    const document = await conversationMemoryService.readForConversation(
      conversationId,
      owner,
      { createIfMissing: true }
    );

    return {
      systemPrompt,
      conversationDocument: document.content,
      currentUserMessage: userMessage,
      metadata: document.metadata
    };
  };

  const buildChatMessages = async (args) => {
    const context = await buildModelContext(args);
    return {
      context,
      messages: [
        {
          role: 'system',
          content: `SYSTEM PROMPT:\n${context.systemPrompt}`
        },
        {
          role: 'user',
          content: `CONVERSATION DOCUMENT:\n${context.conversationDocument}\n\nCURRENT USER MESSAGE:\n${context.currentUserMessage}`
        }
      ]
    };
  };

  const buildImageChatMessages = async ({ imageParts, ...args }) => {
    const context = await buildModelContext(args);
    const parts = Array.isArray(imageParts) ? imageParts : [];
    const contextText = `CONVERSATION DOCUMENT:\n${context.conversationDocument}\n\nCURRENT USER MESSAGE:\n${context.currentUserMessage}`;

    return {
      context,
      messages: [
        {
          role: 'system',
          content: `SYSTEM PROMPT:\n${context.systemPrompt}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: contextText },
            ...parts.filter((part) => part?.type === 'image_url')
          ]
        }
      ]
    };
  };

  const buildRouterContext = (documentContent = '') => {
    const getSection = (heading) => {
      const pattern = new RegExp(`## ${heading}\\s+([\\s\\S]*?)(?=\\n## |$)`);
      const match = String(documentContent || '').match(pattern);
      return match ? match[1].trim() : '';
    };
    const activeReferences = getSection('Active References')
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 5);
    const refs = activeReferences.join('\n');
    return {
      currentTopic: getSection('Current Topic').slice(0, 500),
      activeReferences,
      hasPreviousUploadedImage: /uploaded|آپلود|ارسال شده|تصویر ارسال/i.test(refs),
      hasPreviousGeneratedImage: /generated|ساخته|taskId|تصویر ساخته/i.test(refs)
    };
  };

  return {
    buildModelContext,
    buildChatMessages,
    buildImageChatMessages,
    buildRouterContext
  };
}

module.exports = { createConversationContextBuilder };
