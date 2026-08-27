export type ImageToImageStatus = 'queued' | 'submitted' | 'succeeded' | 'failed';

export type ImageToImageJob = {
  id: string;
  status: ImageToImageStatus;
  prompt: string;
  aspectRatio: '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  inputCount: number;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result: { contentUrl: string; mimeType: string; sizeBytes: number } | null;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('chat_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function assertOk(response: Response, fallback: string) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    error?: string;
    actionKey?: string;
    balanceNoa?: string;
    requiredNoa?: string;
    shortfallNoa?: string;
  };
  const error = Object.assign(new Error(payload.message || payload.error || fallback), {
    code: payload.error,
    status: response.status,
    actionKey: payload.actionKey,
    balanceNoa: payload.balanceNoa,
    requiredNoa: payload.requiredNoa,
    shortfallNoa: payload.shortfallNoa
  });
  throw error;
}

export async function startImageToImage(input: { prompt: string; aspectRatio: string; files: File[]; idempotencyKey: string }): Promise<ImageToImageJob> {
  const body = new FormData();
  body.set('prompt', input.prompt);
  body.set('aspectRatio', input.aspectRatio);
  input.files.forEach((file) => body.append('images', file, file.name));
  const response = await fetch('/api/image-to-image/jobs', {
    method: 'POST', credentials: 'include', headers: { ...authHeaders(), 'Idempotency-Key': input.idempotencyKey }, body
  });
  return await (await assertOk(response, 'ارسال ویرایش تصویر ناموفق بود.')).json() as ImageToImageJob;
}

export async function getImageToImageJob(jobId: string): Promise<ImageToImageJob> {
  const response = await fetch(`/api/image-to-image/jobs/${encodeURIComponent(jobId)}`, { credentials: 'include', headers: authHeaders(), cache: 'no-store' });
  return await (await assertOk(response, 'بررسی وضعیت ویرایش تصویر ناموفق بود.')).json() as ImageToImageJob;
}

export async function listImageToImageJobs(): Promise<ImageToImageJob[]> {
  const response = await fetch('/api/image-to-image/jobs', { credentials: 'include', headers: authHeaders(), cache: 'no-store' });
  const payload = await (await assertOk(response, 'دریافت ویرایش‌های تصویر ناموفق بود.')).json() as { jobs?: ImageToImageJob[] };
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}
