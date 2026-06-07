function createImageGenerationController({ imageGenerationService }) {
  const generateImage = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        return res.status(400).json({
          success: false,
          error: 'Prompt is required.'
        });
      }

      const taskId = await imageGenerationService.generateImageTask(prompt);
      const imageUrl = await imageGenerationService.pollForResult(taskId);

      return res.json({
        success: true,
        imageUrl
      });
    } catch (error) {
      console.error('[image-generation] generateImage failed:', error?.response?.data || error?.message || error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Image generation failed.'
      });
    }
  };

  return {
    generateImage
  };
}

module.exports = { createImageGenerationController };
