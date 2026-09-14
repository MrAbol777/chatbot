import type { StoryboardPlan, StoryboardWorkspace } from './storyboardMaker.types';

function authHeaders() {
  const token = localStorage.getItem('chat_auth_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function analyzeStoryboard(script: string, characters: Array<{ id: string; name: string }>, feedback = ''): Promise<StoryboardPlan> {
  const response = await fetch('/api/storyboards/analyze', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ script, characters, feedback })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.plan) throw new Error(payload?.message || 'تحلیل داستان انجام نشد.');
  return payload.plan as StoryboardPlan;
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({}));
  return typeof payload?.message === 'string' ? payload.message : fallback;
}

export async function listStoryboardWorkspaces(): Promise<StoryboardWorkspace[]> {
  const response = await fetch('/api/storyboard-workspaces', { headers: authHeaders(), credentials: 'include' });
  if (!response.ok) throw new Error(await readError(response, 'دریافت استوری‌بردهای قبلی انجام نشد.'));
  return (await response.json()).workspaces as StoryboardWorkspace[];
}

export async function getStoryboardWorkspace(id: string): Promise<StoryboardWorkspace> {
  const response = await fetch(`/api/storyboard-workspaces/${encodeURIComponent(id)}`, { headers: authHeaders(), credentials: 'include' });
  if (!response.ok) throw new Error(await readError(response, 'دریافت استوری‌برد انجام نشد.'));
  return (await response.json()).workspace as StoryboardWorkspace;
}

type StoryboardWorkspacePayload = Omit<StoryboardWorkspace, 'id' | 'createdAt' | 'updatedAt'>;

export async function createStoryboardWorkspace(workspace: StoryboardWorkspacePayload): Promise<StoryboardWorkspace> {
  const response = await fetch('/api/storyboard-workspaces', { method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ workspace }) });
  if (!response.ok) throw new Error(await readError(response, 'ذخیرهٔ استوری‌برد انجام نشد.'));
  return (await response.json()).workspace as StoryboardWorkspace;
}

export async function updateStoryboardWorkspace(id: string, workspace: StoryboardWorkspacePayload): Promise<StoryboardWorkspace> {
  const response = await fetch(`/api/storyboard-workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ workspace }) });
  if (!response.ok) throw new Error(await readError(response, 'ذخیرهٔ استوری‌برد انجام نشد.'));
  return (await response.json()).workspace as StoryboardWorkspace;
}
