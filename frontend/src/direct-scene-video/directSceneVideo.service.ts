import type { DirectSceneSource, DirectSceneVideoPlan } from './directSceneVideo.types';

const authHeaders = (): Record<string, string> => {
  try {
    const token = localStorage.getItem('chat_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
};

export async function createDirectSceneVideoPlan(input: { workspaceId?: string; title?: string; scenario: string; aspectRatio: string; scenes?: DirectSceneSource[] }): Promise<DirectSceneVideoPlan> {
  const response = await fetch('/api/direct-scene-video/plan', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.plan) throw new Error(payload?.message || 'برنامهٔ ساخت ویدیو آماده نشد.');
  return payload.plan as DirectSceneVideoPlan;
}

export async function composeDirectSceneVideo(generationIds: string[]): Promise<{ montageId: string; contentUrl: string; downloadUrl: string; sizeBytes: number }> {
  const response = await fetch('/api/direct-scene-video/montage', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ generationIds })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.contentUrl) throw new Error(payload?.message || 'اتصال صحنه‌ها به ویدیوی نهایی انجام نشد.');
  return payload as { montageId: string; contentUrl: string; downloadUrl: string; sizeBytes: number };
}
