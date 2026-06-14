/**
 * testimage-generator.service.js
 *
 * Wraps the testimage generate.js logic as a CommonJS module for the backend.
 * Uses the same Metis AI v2/generate endpoint, polls until completion,
 * and saves the resulting images to local output directory.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE = (process.env.METIS_OPENAI_BASE_URL || 'https://api.metisai.ir').replace(/\/openai\/v1$/, '');
const API_KEY = process.env.METIS_API_KEY;
const MODEL_NAME = process.env.METIS_IMAGE_MODEL || 'flux-schnell';

// Output directory for saved images
const OUTPUT_DIR = path.join(__dirname, '..', '..', '..', 'testimage', 'output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Submit an image generation task to Metis AI
 * @param {string} prompt
 * @returns {{ id: string }}
 */
async function createTask(prompt) {
  const response = await axios.post(
    `${API_BASE}/api/v2/generate`,
    {
      model: {
        name: 'openai',
        model: MODEL_NAME,
      },
      operation: 'Imagine',
      args: { prompt },
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

/**
 * Poll task status until completion or failure
 * @param {string} taskId
 * @param {number} intervalMs
 * @returns {object}
 */
async function pollTask(taskId, intervalMs = 3000) {
  while (true) {
    const response = await axios.get(
      `${API_BASE}/api/v2/generate/${taskId}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      }
    );

    const data = response.data;
    const status = (data.status || '').toLowerCase();
    console.log(`[testimage] Poll taskId=${taskId}, status=${data.status}`);

    if (status === 'completed' || status === 'success' || status === 'done') {
      return data;
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`Task failed: ${JSON.stringify(data)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Download an image from URL to local file
 * @param {string} url
 * @param {string} filePath
 */
async function downloadImage(url, filePath) {
  let imageUrl = url;

  // MetisAI /api/tpsgsbxstoragecontainer/... returns JSON with externalUrl
  try {
    const metaResponse = await axios.get(url, { timeout: 10000 });
    if (metaResponse.data && typeof metaResponse.data === 'object' && metaResponse.data.externalUrl) {
      imageUrl = metaResponse.data.externalUrl;
      console.log(`[testimage] Resolved externalUrl: ${imageUrl.slice(0, 80)}...`);
    }
  } catch {
    // Not JSON or failed — use original URL
  }

  const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  fs.writeFileSync(filePath, imageResponse.data);
}

/**
 * Generate images from prompt and save to local output directory
 * @param {string} prompt
 * @param {function} onStatus optional callback for progress
 * @returns {{ taskId: string, savedFiles: string[] }}
 */
async function generateImage(prompt, onStatus) {
  console.log(`\n[testimage] Generating image for: "${prompt}"`);

  // 1. Create task
  console.log('[testimage] Submitting task...');
  const taskData = await createTask(prompt);
  const taskId = taskData.id || taskData.data?.id;
  console.log(`[testimage] Task ID: ${taskId}`);
  onStatus?.('generating', taskId);

  // 2. Poll until done
  console.log('[testimage] Waiting for generation...');
  const result = await pollTask(taskId);

  // 3. Download generated images
  const generations = result.generations || result.data?.generations || [];
  if (generations.length === 0) {
    console.log('[testimage] No images generated.');
    throw new Error('ساخت عکس ناموفق بود — تصویری تولید نشد.');
  }

  console.log(`[testimage] Downloading ${generations.length} image(s)...`);

  const savedFiles = [];

  for (let i = 0; i < generations.length; i++) {
    const imgUrl = generations[i].url || generations[i];
    if (!imgUrl) continue;

    const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
    const fileName = `${taskId}_${i + 1}.${ext}`;
    const filePath = path.join(OUTPUT_DIR, fileName);

    await downloadImage(imgUrl, filePath);
    console.log(`[testimage] Saved: ${filePath}`);
    savedFiles.push(fileName);
  }

  console.log(`[testimage] Done! ${savedFiles.length} image(s) saved to ${OUTPUT_DIR}`);
  return { taskId, savedFiles };
}

module.exports = {
  generateImage,
  OUTPUT_DIR,
};
