import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'https://api.metisai.ir';
const API_KEY = process.env.METIS_API_KEY;
const MODEL_NAME = process.env.METIS_MODEL || 'gpt-image-1';
const OUTPUT_DIR = path.join(__dirname, 'output');

if (!API_KEY) {
    console.error('Error: METIS_API_KEY not set. Copy .env.example to .env and add your key.');
    process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Submit an image generation task to Metis AI
 * @param {string} prompt - The image generation prompt
 * @returns {Promise<string>} task ID
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
            args: {
                prompt,
            },
        },
        {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data;
}

/**
 * Poll task status until completion or failure
 * @param {string} taskId
 * @param {number} intervalMs - Poll interval in milliseconds
 * @returns {Promise<object>} Final task data with generations
 */
async function pollTask(taskId, intervalMs = 3000) {
    while (true) {
        const response = await axios.get(
            `${API_BASE}/api/v2/generate/${taskId}`,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                },
            }
        );

        const data = response.data;
        const status = (data.status || '').toLowerCase();
        console.log(`  Status: ${data.status}`);

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
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(filePath, response.data);
}

/**
 * Main: generate images from prompt and save them
 * @param {string} prompt
 */
async function generateImage(prompt) {
    console.log(`\nGenerating image for: "${prompt}"`);

    // 1. Create task
    console.log('  Submitting task...');
    const taskData = await createTask(prompt);
    const taskId = taskData.id || taskData.data?.id;
    console.log(`  Task ID: ${taskId}`);

    // 2. Poll until done
    console.log('  Waiting for generation...');
    const result = await pollTask(taskId);

    // 3. Download generated images
    const generations = result.generations || result.data?.generations || [];
    if (generations.length === 0) {
        console.log('  No images generated.');
        return;
    }

    console.log(`  Downloading ${generations.length} image(s)...`);

    const timestamp = Date.now();
    const savedPaths = [];

    for (let i = 0; i < generations.length; i++) {
        const imgUrl = generations[i].url || generations[i];
        if (!imgUrl) continue;

        const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
        const fileName = `image_${timestamp}_${i + 1}.${ext}`;
        const filePath = path.join(OUTPUT_DIR, fileName);

        await downloadImage(imgUrl, filePath);
        console.log(`  Saved: ${filePath}`);
        savedPaths.push(filePath);
    }

    console.log(`\nDone! ${savedPaths.length} image(s) saved to ${OUTPUT_DIR}`);
    return savedPaths;
}

// --- CLI Entry ---
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log('Usage: node generate.js "your image prompt here"');
    console.log('Example: node generate.js "a cat sitting on a moon"');
    process.exit(1);
}

const prompt = args.join(' ');
generateImage(prompt).catch((err) => {
    if (err.response) {
        console.error('API Error:', err.response.status, JSON.stringify(err.response.data, null, 2));
    } else {
        console.error('Error:', err.message);
    }
    process.exit(1);
});
