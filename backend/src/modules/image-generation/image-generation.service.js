/**
 * Image generation service — calls Metis AI v2 async API.
 *
 * Endpoints:
 *   POST /api/v2/generate        → creates async task → { id: metisTaskId }
 *   GET  /api/v2/generate/:taskId → polls status     → { status, generations[] }
 *
 * Auth: Authorization: Bearer ${METIS_API_KEY}
 */
function createImageGenerationService({ httpClient, metisApiKey, baseUrl = 'https://api.metisai.ir', imageModel = 'nano-banana-2' }) {

  const getProvider = (model) => {
    const openaiModels = ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'dall-e-3', 'dall-e-2'];
    const googleModels = ['nano-banana', 'nano-banana-pro', 'nano-banana-2'];
    const blackForestModels = ['flux-pro', 'flux-schnell', 'flux-kontext-max', 'flux-kontext-pro'];
    const qwenModels = ['qwen-image-edit'];
    const nightmareModels = ['real-esrgan', 'remove-bg'];
    const fofrModels = ['face-to-sticker', 'become-image'];
    const m = (model || '').toLowerCase();
    if (openaiModels.includes(m)) return 'openai';
    if (googleModels.includes(m)) return 'google';
    if (blackForestModels.includes(m)) return 'black-forest-labs';
    if (qwenModels.includes(m)) return 'qwen';
    if (nightmareModels.includes(m)) return 'nightmareai';
    if (fofrModels.includes(m)) return 'fofr';
    return 'openai';
  };

  const provider = getProvider(imageModel);

  const getHeaders = () => ({
    Authorization: `Bearer ${metisApiKey}`,
    'Content-Type': 'application/json; charset=utf-8'
  });

  /**
   * POST /api/v2/generate — creates an async image generation task.
   * Returns the Metis task ID.
   */
  const createImageGeneration = async (prompt) => {
    const url = `${baseUrl}/api/v2/generate`;
    const body = {
      model: { name: provider, model: imageModel },
      operation: 'Imagine',
      args: { prompt }
    };

    console.log('[image-generation] createImageGeneration REQUEST:', {
      url,
      model: provider + '/' + imageModel,
      promptLength: prompt.length,
      hasApiKey: Boolean(metisApiKey),
      keyPrefix: metisApiKey ? metisApiKey.substring(0, 8) : null
    });

    try {
      const response = await httpClient.post(url, body, { headers: getHeaders() });

      console.log('[image-generation] createImageGeneration RESPONSE:', {
        status: response.status,
        taskId: response?.data?.id
      });

      const taskId = response?.data?.id;
      if (!taskId) {
        throw new Error(`Task id not found in Metis response. Got: ${JSON.stringify(response?.data)}`);
      }

      return taskId;
    } catch (error) {
      const apiError = error?.response?.data;
      const statusCode = error?.response?.status;
      const message = apiError?.error || apiError?.message || error?.message || 'Unknown MetisAI error';
      console.error('[image-generation] createImageGeneration failed:', {
        message,
        statusCode,
        apiError,
        fullResponse: error?.response?.data,
        url
      });
      throw new Error(message);
    }
  };

  /**
   * GET /api/v2/generate/:taskId — polls the status of an async task.
   * Returns { status, imageUrl?, error? }.
   */
  const getImageStatus = async (taskId) => {
    const url = `${baseUrl}/api/v2/generate/${taskId}`;

    try {
      const response = await httpClient.get(url, { headers: getHeaders() });

      const data = response?.data;
      const status = data?.status || 'UNKNOWN';

      console.log('[image-generation] getImageStatus RESPONSE:', {
        taskId,
        status,
        hasGenerations: Boolean(data?.generations?.length)
      });

      if (status === 'COMPLETED') {
        const generation = data?.generations?.[0];
        const imageUrl = generation?.url || generation?.content || null;
        if (!imageUrl) {
          throw new Error(`Image URL not found. Full response: ${JSON.stringify(data)}`);
        }
        return { status: 'COMPLETED', imageUrl };
      }

      if (status === 'ERROR') {
        return { status: 'ERROR', error: data?.error || 'MetisAI task failed.' };
      }

      return { status };
    } catch (error) {
      const statusCode = error?.response?.status;
      const message = error?.response?.data?.error || error?.message || 'Failed to fetch task status.';
      console.error('[image-generation] getImageStatus failed:', {
        message,
        statusCode,
        taskId
      });
      throw new Error(message);
    }
  };

  return {
    createImageGeneration,
    getImageStatus
  };
}

module.exports = { createImageGenerationService };
