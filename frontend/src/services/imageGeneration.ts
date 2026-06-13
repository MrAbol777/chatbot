/**
 * Image generation service — async task-based API.
 *
 * Uses the async endpoints:
 *   POST /api/images/generate  → returns { taskId }
 *   GET  /api/images/status/:taskId  → returns { status, imageUrl?, error? }
 *   GET  /api/images/serve/:taskId   → proxies the image (avoids CORS)
 *
 * Polling is built-in: `generateImageWithPolling()` starts a task and polls
 * until COMPLETED / ERROR or timeout.
 *
 * BUG FIX: Added Authorization header from stored JWT token.
 * The backend auth middleware requires Bearer token for all /api/images/* routes.
 *
 * CORS FIX: Image URLs from MetisAI point to Azure Blob Storage which may have
 * CORS restrictions. We use the /api/images/serve/:taskId proxy endpoint instead.
 */

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 120; // 6 minutes total
const STATUS_POLL_RETRIES = 2; // retry a failed status poll before giving up
const STATUS_POLL_RETRY_DELAY_MS = 1500;

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

/**
 * Helper: wrap fetch with network-level error handling.
 * Catches DNS failures, offline, timeout, etc. and returns a Persian message.
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
 * The token is saved during login/registration under the 'chat_auth_token' key.
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

/**
 * POST /api/images/generate
 * Body: { prompt: string }
 * Returns: taskId string
 */
export async function generateImage(prompt: string): Promise<string> {
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
  if (data.success && data.taskId) {
    return data.taskId;
  }

  throw new Error('شناسه تسک دریافت نشد.');
}

/**
 * GET /api/images/status/:taskId
 */
export async function getImageStatus(taskId: string): Promise<ImageStatusResponse> {
  const response = await safeFetch(`/api/images/status/${taskId}`, {
    method: 'GET',
    headers: authHeaders()
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('احراز هویت نامعتبر. لطفاً دوباره وارد شوید.');
    }
    throw new Error(errorData.error || 'بررسی وضعیت عکس ناموفق بود.');
  }

  return (await response.json()) as ImageStatusResponse;
}

/**
 * Wrapper around getImageStatus with transient-failure retry.
 * If a poll fails (network blip, 500), retry before giving up.
 */
async function getImageStatusWithRetry(taskId: string): Promise<ImageStatusResponse | null> {
  for (let attempt = 0; attempt <= STATUS_POLL_RETRIES; attempt += 1) {
    try {
      return await getImageStatus(taskId);
    } catch {
      if (attempt >= STATUS_POLL_RETRIES) return null;
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * Starts an image generation task and polls until completion, error, or timeout.
 *
 * @param prompt - Image description text
 * @param onProgress - Optional callback called on each non-terminal poll cycle
 * @returns The proxy imageUrl when COMPLETED (served via /api/images/serve/:taskId to avoid CORS)
 * @throws Error on ERROR status, timeout, or API failure
 */
export async function generateImageWithPolling(
  prompt: string,
  onProgress?: (status: ImageTaskStatus, attempt: number) => void
): Promise<string> {
  const taskId = await generateImage(prompt);

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = await getImageStatusWithRetry(taskId);
    if (!result) {
      // Poll failed after retries — skip this cycle and keep polling
      continue;
    }

    if (result.status === 'COMPLETED') {
      if (result.imageUrl) {
        // Return proxy URL instead of direct Azure Blob URL to avoid CORS issues
        return `/api/images/serve/${taskId}`;
      }
      throw new Error('تسک تکمیل شد اما لینک عکس دریافت نشد.');
    }

    if (result.status === 'ERROR') {
      throw new Error(result.error || 'ساخت عکس با خطا مواجه شد.');
    }

    // QUEUE or IN_PROGRESS
    onProgress?.(result.status, attempt);
  }

  throw new Error('ساخت عکس بیش از حد طول کشید. لطفاً دوباره تلاش کن.');
}

export type { ImageTaskStatus, GenerateImageResponse, ImageStatusResponse };
