/**
 * Image generation service — local file-save based API.
 *
 * Uses the new testimage-generator endpoints:
 *   POST /api/local-images/generate  → blocks until done, returns image URLs
 *   GET  /api/local-images/serve/:fileName → serves saved image
 *
 * No polling needed — the backend handles everything synchronously.
 */

/**
 * Helper: wrap fetch with network-level error handling.
 */
async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('درخواست بیش از حد طول کشید. لطفاً دوباره تلاش کنید.');
    }
    throw new Error('خطای شبکه. لطفاً اتصال اینترنت را بررسی کنید.');
  }
}

/**
 * Helper: read the JWT token from localStorage.
 */
function getAuthToken(): string | null {
  try {
    return localStorage.getItem('chat_auth_token');
  } catch {
    return null;
  }
}

/**
 * Helper: build common fetch headers with Authorization.
 */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

interface GenerateLocalImageResponse {
  success: boolean;
  taskId: string;
  imageUrls: string[];
  error?: string;
}

/**
 * POST /api/local-images/generate
 * Body: { prompt: string }
 * Returns: { success, taskId, imageUrls: string[] }
 *
 * This endpoint blocks until generation is complete — no polling needed.
 */
export async function generateImageLocal(prompt: string): Promise<string[]> {
  const response = await safeFetch('/api/local-images/generate', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('احراز هویت نامعتبر. لطفاً دوباره وارد شوید.');
    }
    throw new Error(errorData.error || 'ساخت عکس ناموفق بود.');
  }

  const data = (await response.json()) as GenerateLocalImageResponse;
  if (data.success && data.imageUrls && data.imageUrls.length > 0) {
    return data.imageUrls;
  }

  throw new Error(data.error || 'شناسه تسک یا لینک عکس دریافت نشد.');
}

/**
 * Legacy wrapper for backwards compatibility with existing callers.
 * Calls the new local endpoint and returns the first image URL.
 */
export async function generateImageWithPolling(
  prompt: string,
  _onProgress?: (_status: string, _attempt: number) => void
): Promise<string> {
  const urls = await generateImageLocal(prompt);
  return urls[0];
}

// Re-export old types for compatibility
type ImageTaskStatus = 'QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'ERROR';

interface GenerateImageResponse {
  success: boolean;
  taskId: string;
  message?: string;
}

interface ImageStatusResponse {
  success: boolean;
  taskId: string;
  status: ImageTaskStatus;
  imageUrl?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type { ImageTaskStatus, GenerateImageResponse, ImageStatusResponse };
