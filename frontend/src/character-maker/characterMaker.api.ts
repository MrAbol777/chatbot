import type { CharacterAnalysis, CharacterWorkspace } from './characterMaker.types';

function authHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem('chat_auth_token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* Cookie sessions continue to work. */ }
  return headers;
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({}));
  return typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : fallback;
}

export async function analyzeCharacters(scenario: string): Promise<CharacterAnalysis> {
  const response = await fetch('/api/character-maker/analyze', { method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ scenario }) });
  if (!response.ok) throw new Error(await readError(response, 'تحلیل سناریو انجام نشد.'));
  const payload = await response.json();
  return payload.analysis as CharacterAnalysis;
}

export async function listCharacterWorkspaces(): Promise<CharacterWorkspace[]> {
  const response = await fetch('/api/character-workspaces', { headers: authHeaders(), credentials: 'include' });
  if (!response.ok) throw new Error(await readError(response, 'دریافت کتابخانه انجام نشد.'));
  return (await response.json()).workspaces as CharacterWorkspace[];
}

export async function getCharacterWorkspace(id: string): Promise<CharacterWorkspace> {
  const response = await fetch(`/api/character-workspaces/${encodeURIComponent(id)}`, { headers: authHeaders(), credentials: 'include' });
  if (!response.ok) throw new Error(await readError(response, 'دریافت پروژه انجام نشد.'));
  return (await response.json()).workspace as CharacterWorkspace;
}

export async function createCharacterWorkspace(workspace: Omit<CharacterWorkspace, 'id' | 'createdAt' | 'updatedAt'>): Promise<CharacterWorkspace> {
  const response = await fetch('/api/character-workspaces', { method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ workspace }) });
  if (!response.ok) throw new Error(await readError(response, 'ذخیره‌ی پروژه انجام نشد.'));
  return (await response.json()).workspace as CharacterWorkspace;
}

export async function updateCharacterWorkspace(id: string, workspace: Omit<CharacterWorkspace, 'id' | 'createdAt' | 'updatedAt'>): Promise<CharacterWorkspace> {
  const response = await fetch(`/api/character-workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ workspace }) });
  if (!response.ok) throw new Error(await readError(response, 'ذخیره‌ی تغییرات انجام نشد.'));
  return (await response.json()).workspace as CharacterWorkspace;
}
