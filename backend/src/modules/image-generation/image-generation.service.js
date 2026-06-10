function createImageGenerationService({ httpClient, metisApiKey, baseUrl = 'https://api.metisai.ir', imageModel = 'nano-banana-2' }) {
  // Determine provider from model name
  const getProvider = (model) => {
    const openaiModels = ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'dall-e-3', 'dall-e-2'];
    const googleModels = ['nano-banana', 'nano-banana-pro', 'nano-banana-2'];
    const m = (model || '').toLowerCase();
    if (openaiModels.includes(m)) return 'openai';
    if (googleModels.includes(m)) return 'google';
    return 'openai'; // default
  };

  const provider = getProvider(imageModel);

  const getHeaders = () => ({
    Authorization: `Bearer ${metisApiKey}`,
    'Content-Type': 'application/json'
  });

  /**
   * Sends a POST request to MetisAI to start an image generation task.
   * Returns the task_id from MetisAI.
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
      body,
      hasApiKey: Boolean(metisApiKey),
      keyPrefix: metisApiKey ? metisApiKey.substring(0, 8) : null
    });

    try {
      const response = await httpClient.post(url, body, { headers: getHeaders() });

      console.log('[image-generation] createImageGeneration RESPONSE:', {
        status: response.status,
        data: response.data,
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
   * Sends a GET request to MetisAI to check the status of an async task.
   * Returns { status, imageUrl?, error? }.
   */
  const getImageStatus = async (taskId) => {
    const url = `${baseUrl}/api/v2/generate/${taskId}`;

    try {
      const response = await httpClient.get(url, {
        headers: getHeaders()
      });

      const data = response?.data;
      const status = data?.status || 'UNKNOWN';

      console.log('[image-generation] getImageStatus RESPONSE:', { taskId, status, generations: data?.generations, data: { ...data, generations: undefined } });

      if (status === 'COMPLETED') {
        // MetisAI returns generations array with url, contentType, content fields
        // Try url first, then content as fallback
        const generation = data?.generations?.[0];
        console.log('[image-generation] COMPLETED generation details:', JSON.stringify(generation));
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
        taskId,
        apiError: error?.response?.data
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
