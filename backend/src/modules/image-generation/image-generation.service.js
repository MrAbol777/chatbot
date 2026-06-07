const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createImageGenerationService({ httpClient, metisApiKey, baseUrl = 'https://api.metisai.ir' }) {
  const getHeaders = () => ({
    Authorization: `Bearer ${metisApiKey}`,
    'Content-Type': 'application/json'
  });

  const generateImageTask = async (prompt) => {
    try {
      const response = await httpClient.post(
        `${baseUrl}/api/v2/generate`,
        {
          name: 'google',
          model: 'nano-banana',
          args: {
            prompt
          }
        },
        {
          headers: getHeaders()
        }
      );

      const taskId = response?.data?.id;
      if (!taskId) {
        throw new Error('Task id not found in Metis response.');
      }

      return taskId;
    } catch (error) {
      console.error('[image-generation] generateImageTask failed:', error?.response?.data || error?.message || error);
      throw error;
    }
  };

  const pollForResult = async (taskId, maxAttempts = 60, intervalMs = 3000) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await httpClient.get(`${baseUrl}/api/v2/generate/${taskId}`, {
          headers: getHeaders()
        });
        const status = response?.data?.status;

        if (status === 'COMPLETED') {
          const url = response?.data?.generations?.[0]?.url;
          if (!url) {
            throw new Error('Image URL not found in completed task response.');
          }
          return url;
        }

        if (status === 'ERROR') {
          throw new Error(response?.data?.error || 'Metis image generation task failed.');
        }
      } catch (error) {
        console.error('[image-generation] pollForResult failed:', error?.response?.data || error?.message || error);
        throw error;
      }

      if (attempt < maxAttempts) {
        await delay(intervalMs);
      }
    }

    throw new Error('Image generation timed out.');
  };

  return {
    generateImageTask,
    pollForResult
  };
}

module.exports = { createImageGenerationService };
