/**
 * Image generation service — Metis AI backend.
 *
 * Endpoints:
 *   POST /api/images/generate  → { success, taskId }
 *   GET  /api/images/status/:taskId → { success, status, imageUrl?, error? }
 */

// Use absolute URL to bypass Vite proxy issues
const BACKEND_URL = 'http://localhost:3000';

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('اتصال به سرور برقرار نشد.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('درخواست بیش از حد طول کشید.');
    }
    throw new Error('خطای شبکه.');
  }
}

function getAuthToken(): string | null {
  try { return localStorage.getItem('chat_auth_token'); } catch { return null; }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getAuthToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export type ImageTaskStatus = 'QUEUE' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'ERROR';

interface GenerateImageResponse { success: boolean; taskId: string; error?: string; }
interface ImageStatusResponse {
  success: boolean; taskId: string; status: ImageTaskStatus;
  imageUrl?: string | null; error?: string | null;
}

export async function startImageGeneration(prompt: string): Promise<{ taskId: string }> {
  const res = await safeFetch(`${BACKEND_URL}/api/images/generate`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ prompt })
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'ساخت عکس ناموفق بود.');
  }
  const d = await res.json() as GenerateImageResponse;
  if (!d.success || !d.taskId) throw new Error(d.error || 'شناسه تسک دریافت نشد.');
  return { taskId: d.taskId };
}

export async function getImageGenerationStatus(taskId: string): Promise<{
  status: ImageTaskStatus; imageUrl?: string | null; error?: string | null;
}> {
  const res = await safeFetch(`${BACKEND_URL}/api/images/status/${taskId}`, {
    headers: { ...authHeaders(), 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'بررسی وضعیت انجام نشد.');
  }
  const d = await res.json() as ImageStatusResponse;
  return { status: d.status, imageUrl: d.imageUrl, error: d.error };
}

/**
 * Starts generation, polls until COMPLETED or ERROR, returns the final imageUrl.
 */
export async function generateImageWithPolling(
  prompt: string,
  onProgress?: (status: string) => void
): Promise<string> {
  const { taskId } = await startImageGeneration(prompt);

  const INTERVAL = 2000;
  const MAX = 90;
  let polls = 0;

  while (polls < MAX) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    polls++;

    const { status, imageUrl, error } = await getImageGenerationStatus(taskId);

    if (status === 'COMPLETED' && imageUrl) {
      // Backend returns absolute URL like http://localhost:3000/api/uploads/images/:id
      // Use as-is
      return imageUrl;
    }
    if (status === 'ERROR') throw new Error(error || 'ساخت عکس با خطا مواجه شد.');

    onProgress?.(status === 'QUEUE' ? 'در صف انتظار...' : 'در حال ساخت عکس...');
  }

  throw new Error('ساخت عکس بیش از حد طول کشید.');
}

export type { GenerateImageResponse, ImageStatusResponse };
