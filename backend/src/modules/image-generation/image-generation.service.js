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
    try {
      const response = await httpClient.post(
        `${baseUrl}/api/v2/generate`,
        {
          name: 'openai',
          model: 'gpt-image-1.5',
          args: { prompt }
        },
        { headers: getHeaders() }
      );

      const taskId = response?.data?.id;
      if (!taskId) {
        throw new Error('Task id not found in Metis response.');
      }

      return taskId;
    } catch (error) {
      const apiError = error?.response?.data;
      const message = apiError?.error || apiError?.message || error?.message || 'Unknown MetisAI error';
      console.error('[image-generation] createImageGeneration failed:', message);
      throw new Error(message);
    }
  };

  /**
   * Sends a GET request to MetisAI to check the status of an async task.
   * Returns { status, imageUrl?, error? }.
   */
  const getImageStatus = async (taskId) => {
    try {
      const response = await httpClient.get(`${baseUrl}/api/v2/generate/${taskId}`, {
        headers: getHeaders()
      });

      const data = response?.data;
      const status = data?.status || 'UNKNOWN';

      if (status === 'COMPLETED') {
        const imageUrl = data?.generations?.[0]?.url;
        if (!imageUrl) {
          throw new Error('Image URL not found in completed task response.');
        }
        return { status: 'COMPLETED', imageUrl };
      }

      if (status === 'ERROR') {
        return { status: 'ERROR', error: data?.error || 'MetisAI task failed.' };
      }

      return { status };
    } catch (error) {
      const message = error?.response?.data?.error || error?.message || 'Failed to fetch task status.';
      console.error('[image-generation] getImageStatus failed:', message);
      throw new Error(message);
    }
  };

  return {
    createImageGeneration,
    getImageStatus
  };
}

module.exports = { createImageGenerationService };
