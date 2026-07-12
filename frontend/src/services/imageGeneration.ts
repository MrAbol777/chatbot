/**
 * Image generation service — Metis AI backend.
 *
 * Endpoints:
 *   POST /api/images/generate  → { success, taskId }
 *   GET  /api/images/status/:taskId → { success, status, imageUrl?, error? }
 */

const apiUrl = (path: string) => path;

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

interface GenerateImageResponse { success: boolean; taskId: string; error?: string; message?: string; }
interface ImageStatusResponse {
  success: boolean; taskId: string; status: ImageTaskStatus;
  imageUrl?: string | null; error?: string | null;
}

export async function startImageGeneration(prompt: string, options: { aspectRatio?: string; idempotencyKey?: string; conversationId?: string } = {}): Promise<{ taskId: string }> {
  const res = await safeFetch(apiUrl('/api/images/generate'), {
    method: 'POST', headers: { ...authHeaders(), ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) },
    credentials: 'include', body: JSON.stringify({ prompt, aspectRatio: options.aspectRatio, conversationId: options.conversationId })
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || e.error || 'ساخت عکس ناموفق بود.');
  }
  const d = await res.json() as GenerateImageResponse;
  if (!d.success || !d.taskId) throw new Error(d.error || 'شناسه تسک دریافت نشد.');
  return { taskId: d.taskId };
}

export type GalleryImage = {
  id: string; taskId: string; originalPrompt: string; refinedPrompt: string;
  model?: string | null; aspectRatio: '1:1' | '9:16' | '16:9'; operation: 'generate' | 'edit';
  conversationId?: string | null; parentImageId?: string | null; status: ImageTaskStatus;
  imageUrl?: string | null; error?: string | null; createdAt: string; updatedAt: string;
};

export async function listGalleryImages(cursor = 0) {
  const res = await safeFetch(`/api/images?limit=24&cursor=${cursor}`, { headers: authHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error('دریافت تصاویر انجام نشد.');
  return res.json() as Promise<{ items: GalleryImage[]; nextCursor: number | null }>;
}

export async function deleteGalleryImage(id: string) {
  const res = await safeFetch(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error('حذف تصویر انجام نشد.');
}

export async function startImageEdit(sourceImageId: string, prompt: string, aspectRatio: string, idempotencyKey: string) {
  const res = await safeFetch('/api/images/edit', { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey }, credentials: 'include', body: JSON.stringify({ sourceImageId, prompt, aspectRatio }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.taskId) throw new Error(data.message || data.error || 'ویرایش تصویر انجام نشد.');
  return { taskId: String(data.taskId) };
}

export async function getImageGenerationStatus(taskId: string): Promise<{
  status: ImageTaskStatus; imageUrl?: string | null; error?: string | null;
}> {
  return getImageGenerationStatusForConversation(taskId);
}

export async function getImageGenerationStatusForConversation(taskId: string, conversationId?: string): Promise<{
  status: ImageTaskStatus; imageUrl?: string | null; error?: string | null;
}> {
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
  const res = await safeFetch(apiUrl(`/api/images/status/${taskId}${query}`), {
    headers: { ...authHeaders(), 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'بررسی وضعیت انجام نشد.');
  }
  const d = await res.json() as ImageStatusResponse;
  return { status: d.status, imageUrl: d.imageUrl, error: d.error };
}

export async function fetchProtectedImageBlobUrl(imageUrl: string): Promise<string> {
  const res = await safeFetch(apiUrl(imageUrl), {
    headers: authHeaders(),
    credentials: 'include'
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'بارگذاری تصویر انجام نشد.');
  }
  return URL.createObjectURL(await res.blob());
}

/**
 * Starts generation, polls until COMPLETED or ERROR, returns the final imageUrl.
 * Includes retry logic for 404 on image load (race condition fix).
 */
export async function generateImageWithPolling(
  prompt: string,
  onProgress?: (status: string) => void,
  options?: { conversationId?: string }
): Promise<string> {
  const { taskId } = await startImageGeneration(prompt);

  const INTERVAL = 2000;
  const MAX = 90;
  let polls = 0;

  while (polls < MAX) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    polls++;

    const { status, imageUrl, error } = await getImageGenerationStatusForConversation(taskId, options?.conversationId);

    if (status === 'COMPLETED' && imageUrl) {
      if (imageUrl.startsWith('/api/images/result/') || imageUrl.startsWith('/api/images/serve/')) {
        return imageUrl;
      }
      // Backend returns a same-origin URL like /api/uploads/images/:id
      // Retry if 404 (file might still be flushing to disk)
      const maxRetries = 5;
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          const imgRes = await safeFetch(imageUrl, { method: 'HEAD' });
          if (imgRes.ok) {
            return imageUrl;
          }
          if (imgRes.status !== 404) {
            // Other error, return anyway
            return imageUrl;
          }
        } catch {
          // Network error, try again
        }
        // Wait before retry
        await new Promise((r) => setTimeout(r, 500));
      }
      // If all retries failed, return URL anyway (let img tag handle error)
      return imageUrl;
    }
    if (status === 'ERROR') throw new Error(error || 'ساخت عکس با خطا مواجه شد.');

    onProgress?.(status === 'QUEUE' ? 'در صف انتظار...' : 'در حال ساخت عکس...');
  }

  throw new Error('ساخت عکس بیش از حد طول کشید.');
}

export type { GenerateImageResponse, ImageStatusResponse };
