function createAiController({ aiService, errorsRepository }) {
  const postChat = async (req, res) => {
    try {
      const { message, profile, history, conversationId } = req.body || {};
      const result = await aiService.sendChatMessage({
        message,
        profile,
        history,
        conversationId,
        requestId: res.locals.requestId
      });

      return res.json(result);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'API_KEY_MISSING') {
        await errorsRepository.logError('api_key_missing', '/api/chat', 500, 'METIS_API_KEY is missing');
        return res.status(500).json({ error: 'کلید API تنظیم نشده است.' });
      }

      if (error && typeof error === 'object' && error.code === 'INVALID_MESSAGE') {
        return res.status(400).json({ error: 'پیام معتبر ارسال نشده است.' });
      }

      if (error && typeof error === 'object' && error.code === 'UPSTREAM_TIMEOUT') {
        await errorsRepository.logError('openai_timeout', '/api/chat', 504, 'Upstream timeout reached');
        return res.status(504).json({ error: 'زمان پاسخ مدل طولانی شد. لطفاً دوباره تلاش کن.' });
      }

      if (error && typeof error === 'object' && error.code === 'UPSTREAM_FETCH_FAILED') {
        await errorsRepository.logError('openai_fetch_failed', '/api/chat', 502, JSON.stringify(error.details || {}));
        return res.status(502).json({
          error: 'ارتباط با سرویس مدل برقرار نشد.',
          details: 'اتصال شبکه، DNS یا METIS_OPENAI_BASE_URL را بررسی کنید.'
        });
      }

      if (error && typeof error === 'object' && error.code === 'UPSTREAM_REQUEST_FAILED') {
        const status = Number(error?.details?.status);
        const safeStatus = Number.isInteger(status) && status >= 400 ? status : 502;
        await errorsRepository.logError('openai_upstream_error', '/api/chat', safeStatus, JSON.stringify(error.details || {}));
        return res.status(safeStatus).json({
          error: 'خطا از سرویس مدل دریافت شد.',
          details: error?.details?.details || 'unknown_upstream_error'
        });
      }

      if (error && typeof error === 'object' && error.code === 'EMPTY_UPSTREAM_REPLY') {
        await errorsRepository.logError('invalid_upstream_response', '/api/chat', 502, JSON.stringify(error.details || {}));
        return res.status(502).json({ error: 'پاسخ نامعتبر از مدل دریافت شد.' });
      }

      await errorsRepository.logError('unknown', '/api/chat', null, error instanceof Error ? error.stack || error.message : 'unknown_error');

      return res.status(500).json({
        error: 'مشکلی در سرور پیش آمد.',
        details: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  };

  return {
    postChat
  };
}

module.exports = { createAiController };
