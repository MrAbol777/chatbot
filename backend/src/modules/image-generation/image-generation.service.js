function createImageGenerationService({ httpClient, metisApiKey, baseUrl = 'https://api.metisai.ir' }) {
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
      name: 'openai',
      model: 'gpt-image-1.5',
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

      console.log('[image-generation] getImageStatus RESPONSE:', { taskId, status, data });

      if (status === 'COMPLETED') {
        const imageUrl = data?.generations?.[0]?.url;
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
