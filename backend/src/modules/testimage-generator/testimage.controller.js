/**
 * testimage-generator.controller.js
 *
 * Handles HTTP requests for local image generation.
 * - POST /api/local-images/generate  → starts generation (blocking)
 * - GET  /api/local-images/serve/:fileName → serves saved image
 */

const path = require('path');
const fs = require('fs');

function createTestimageController({ testimageService }) {
  /**
   * POST /api/local-images/generate
   * Body: { prompt: string }
   * Returns: { success: true, taskId, imageUrls: string[] }
   */
  const generateImage = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        return res.status(400).json({
          success: false,
          error: 'Prompt is required.'
        });
      }

      console.log('[testimage] Generate request:', prompt.slice(0, 80));

      const { taskId, savedFiles } = await testimageService.generateImage(prompt);

      // Return relative URLs for frontend to load
      const imageUrls = savedFiles.map((f) => `/api/local-images/serve/${encodeURIComponent(f)}`);

      return res.status(200).json({
        success: true,
        taskId,
        imageUrls
      });
    } catch (error) {
      console.error('[testimage] generateImage failed:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null
      });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'ساخت عکس ناموفق بود.'
      });
    }
  };

  /**
   * GET /api/local-images/serve/:fileName
   * Serves a saved image file from the output directory.
   */
  const serveImage = async (req, res) => {
    try {
      const { fileName } = req.params;

      if (!fileName) {
        return res.status(400).json({ success: false, error: 'fileName is required.' });
      }

      const filePath = path.join(testimageService.OUTPUT_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found.' });
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return res.status(400).json({ success: false, error: 'Not a valid image.' });
      }

      const ext = path.extname(fileName).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Length', stat.size);

      return res.sendFile(filePath);
    } catch (error) {
      console.error('[testimage] serveImage failed:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Failed to serve image.' });
    }
  };

  return {
    generateImage,
    serveImage,
  };
}

module.exports = { createTestimageController };
