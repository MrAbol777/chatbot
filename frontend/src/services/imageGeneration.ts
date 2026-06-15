/**
 * Image generation service — Metis AI (OpenAI-compatible) backend.
 *
 * Endpoints:
 *   POST /api/images/generate  → { success, taskId }
 *   GET  /api/images/status/:taskId → { success, status, imageUrl?, error? }
 *   GET  /api/images/serve/:taskId → serves image (public, no auth)
 *
 * Flow: idle → submitting → polling → done | error
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

/* ── Types ────────────────────────────────────────────────────── */

export type ImageTaskStatus = 'QUEUE' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'ERROR';

interface GenerateImageResponse {
  success: boolean;
  taskId: string;
  message?: string;
  error?: string;
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

/* ── Public API ───────────────────────────────────────────────── */

/**
 * POST /api/images/generate
 * Starts an image generation task. Returns { taskId } immediately.
 */
export async function startImageGeneration(prompt: string): Promise<{ taskId: string }> {
  const response = await safeFetch('/api/images/generate', {
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

  const data = (await response.json()) as GenerateImageResponse;
  if (!data.success || !data.taskId) {
    throw new Error(data.error || 'شناسه تسک دریافت نشد.');
  }

  return { taskId: data.taskId };
}

/**
 * GET /api/images/status/:taskId
 * Returns { status, imageUrl?, error? }.
 */
export async function getImageGenerationStatus(taskId: string): Promise<{
  status: ImageTaskStatus;
  imageUrl?: string | null;
  error?: string | null;
}> {
  const response = await safeFetch(`/api/images/status/${taskId}`, {
    headers: authHeaders()
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('احراز هویت نامعتبر. لطفاً دوباره وارد شوید.');
    }
    if (response.status === 404) {
      throw new Error(errorData.error || 'تسک یافت نشد.');
    }
    throw new Error(errorData.error || 'بررسی وضعیت انجام نشد.');
  }

  const data = (await response.json()) as ImageStatusResponse;
  return {
    status: data.status,
    imageUrl: data.imageUrl,
    error: data.error
  };
}

/**
 * Poll for image generation completion.
 * Starts a task, then polls status until COMPLETED or ERROR.
 * Calls onProgress(status, attempt) on each poll.
 * Returns the final imageUrl.
 */
export async function generateImageWithPolling(
  prompt: string,
  onProgress?: (status: string, attempt: number) => void
): Promise<string> {
  const { taskId } = await startImageGeneration(prompt);

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 90; // ~3 minutes total
  let attempt = 0;

  while (attempt < MAX_POLLS) {
    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    attempt += 1;

    const { status, imageUrl, error } = await getImageGenerationStatus(taskId);

    if (status === 'COMPLETED' && imageUrl) {
      // Resolve the full URL for the img tag
      const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${window.location.origin}${imageUrl}`;
      return fullUrl;
    }

    if (status === 'ERROR') {
      throw new Error(error || 'ساخت عکس با خطا مواجه شد.');
    }

    // Non-terminal: QUEUE, RUNNING, WAITING
    const statusLabel = status === 'QUEUE' ? 'در صف انتظار...' : 'در حال ساخت عکس...';
    onProgress?.(statusLabel, attempt);
  }

  throw new Error('ساخت عکس بیش از حد طول کشید. لطفاً دوباره تلاش کنید.');
}

export type { GenerateImageResponse, ImageStatusResponse };
