import { createChatRequestError, safeFetch } from '../services/chatStream';
import { buildScenarioPromptPayload } from './storyMaker.service';
import type { StoryBrief, StoryContext, StoryDraft, StoryPlanPreview, StoryScenario, StoryWorkspace } from './storyMaker.types';

type ScenarioResponse = { scenario?: string; displayScenario?: string; story?: StoryScenario; model?: string; scenes?: number; quality?: { status: string; repaired: boolean }; error?: string; message?: string };
type BriefResponse = { brief?: StoryBrief; model?: string; error?: string; message?: string };
type PreviewResponse = { preview?: StoryPlanPreview; model?: string; error?: string; message?: string };
type WorkspaceResponse = { workspace?: StoryWorkspace; workspaces?: StoryWorkspace[]; error?: string; message?: string };

function authHeaders() {
  const token = localStorage.getItem('chat_auth_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function workspaceRequest(path: string, init?: RequestInit): Promise<WorkspaceResponse> {
  const response = await safeFetch(path, { ...init, headers: authHeaders(), credentials: 'include' });
  let data: WorkspaceResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok) throw createChatRequestError(data.message || 'فضای داستان در دسترس نیست.', response.status, data);
  return data;
}

export async function listStoryWorkspaces() { return (await workspaceRequest('/api/story-workspaces')).workspaces || []; }
export async function getStoryWorkspace(id: string) { const workspace = (await workspaceRequest(`/api/story-workspaces/${encodeURIComponent(id)}`)).workspace; if (!workspace) throw new Error('داستان پیدا نشد.'); return workspace; }
export async function createStoryWorkspace(workspace: Omit<StoryWorkspace, 'id' | 'createdAt' | 'updatedAt'>) { const result = await workspaceRequest('/api/story-workspaces', { method: 'POST', body: JSON.stringify({ workspace }) }); if (!result.workspace) throw new Error('فضای داستان ساخته نشد.'); return result.workspace; }
export async function updateStoryWorkspace(id: string, workspace: Omit<StoryWorkspace, 'id' | 'createdAt' | 'updatedAt'>) { const result = await workspaceRequest(`/api/story-workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ workspace }) }); if (!result.workspace) throw new Error('فضای داستان ذخیره نشد.'); return result.workspace; }

export async function prepareStoryBrief(draft: StoryDraft, signal?: AbortSignal): Promise<StoryBrief> {
  const payload = buildScenarioPromptPayload(draft);
  const response = await safeFetch('/api/story-scenarios/brief', {
    method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ draft: payload.draft }), signal
  });
  let data: BriefResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data.brief?.summary) {
    throw createChatRequestError(data.message || 'نتوانستم ایده‌ی داستان را بررسی کنم. دوباره امتحان کن.', response.status, data);
  }
  return data.brief;
}

export async function clarifyStoryBrief(draft: StoryDraft, context: StoryContext, feedback: string, signal?: AbortSignal): Promise<StoryBrief> {
  const payload = buildScenarioPromptPayload(draft);
  const response = await safeFetch('/api/story-scenarios/brief/clarify', {
    method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ draft: payload.draft, context, feedback }), signal
  });
  let data: BriefResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data.brief?.summary) {
    throw createChatRequestError(data.message || 'نتوانستم جزئیات لازم داستان را بررسی کنم. دوباره امتحان کن.', response.status, data);
  }
  return data.brief;
}

export async function prepareStoryPreview(draft: StoryDraft, context: StoryContext, signal?: AbortSignal): Promise<StoryPlanPreview> {
  const payload = buildScenarioPromptPayload(draft);
  const response = await safeFetch('/api/story-scenarios/brief/preview', {
    method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ draft: payload.draft, context }), signal
  });
  let data: PreviewResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data.preview?.overview) {
    throw createChatRequestError(data.message || 'نتوانستم طرح اولیه‌ی داستان را آماده کنم. دوباره امتحان کن.', response.status, data);
  }
  return data.preview;
}

function readScenarioResponse(data: ScenarioResponse, response: Response, fallbackScenes: number) {
  if (!response.ok || !data.scenario?.trim() || !data.story) {
    throw createChatRequestError(data.message || 'سناریو ساخته نشد. لطفاً دوباره امتحان کن.', response.status, data);
  }
  const scenario = data.scenario.trim();
  return { scenario, displayScenario: data.displayScenario?.trim() || scenario, story: data.story, model: data.model || '', scenes: data.scenes || fallbackScenes, quality: data.quality };
}

export async function generateStoryScenario(draft: StoryDraft, context?: StoryContext, signal?: AbortSignal) {
  const payload = buildScenarioPromptPayload(draft);
  const response = await safeFetch('/api/story-scenarios', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ draft: payload.draft, context }),
    signal
  });
  let data: ScenarioResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  return readScenarioResponse(data, response, payload.output.scenes);
}

export async function reviseStoryScenario(story: StoryScenario, expectedScenes: number, request: string, targetScene?: number) {
  const response = await safeFetch('/api/story-scenarios/revise', { method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ story, expectedScenes, request, targetScene }) });
  let data: ScenarioResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  return readScenarioResponse(data, response, expectedScenes);
}

export async function validateStoryScenario(story: StoryScenario, expectedScenes: number) {
  const response = await safeFetch('/api/story-scenarios/validate', { method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ story, expectedScenes }) });
  let data: ScenarioResponse = {};
  try { data = await response.json(); } catch { /* handled below */ }
  return readScenarioResponse(data, response, expectedScenes);
}
