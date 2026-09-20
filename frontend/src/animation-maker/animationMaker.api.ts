import { createChatRequestError, safeFetch } from '../services/chatStream';
import type { AnimationProject, AnimationProjectInput, AnimationProjectSummary } from './animationMaker.types';

type ResponsePayload = { project?: AnimationProject; projects?: AnimationProjectSummary[]; message?: string };
export type AnimationReviewAction = 'scenario_approved' | 'characters_generating' | 'characters_review' | 'characters_approved' | 'storyboard_generating' | 'storyboard_review' | 'storyboard_approved' | 'video_queued' | 'video_processing' | 'completed' | 'failed';

function authHeaders() {
  const token = localStorage.getItem('chat_auth_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function request(path: string, init?: RequestInit): Promise<ResponsePayload> {
  const response = await safeFetch(path, { ...init, headers: authHeaders(), credentials: 'include' });
  let data: ResponsePayload = {};
  try { data = await response.json(); } catch { /* Converted to a useful request error below. */ }
  if (!response.ok) throw createChatRequestError(data.message || 'پروژهٔ انیمیشن ذخیره نشد.', response.status, data);
  return data;
}

export async function listAnimationProjects() { return (await request('/api/animation-projects')).projects || []; }
export async function getAnimationProject(id: string) {
  const project = (await request(`/api/animation-projects/${encodeURIComponent(id)}`)).project;
  if (!project) throw new Error('پروژهٔ انیمیشن پیدا نشد.');
  return project;
}
export async function createAnimationProject(project: AnimationProjectInput) {
  const saved = (await request('/api/animation-projects', { method: 'POST', body: JSON.stringify({ project }) })).project;
  if (!saved) throw new Error('پروژهٔ انیمیشن ساخته نشد.');
  return saved;
}
export async function updateAnimationProject(id: string, project: AnimationProjectInput) {
  const saved = (await request(`/api/animation-projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ project }) })).project;
  if (!saved) throw new Error('ذخیرهٔ پروژه انجام نشد.');
  return saved;
}

export async function transitionAnimationProject(id: string, action: AnimationReviewAction, data: Record<string, unknown> = {}) {
  const saved = (await request(`/api/animation-projects/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ action, data }) })).project;
  if (!saved) throw new Error('ذخیرهٔ وضعیت بررسی انجام نشد.');
  return saved;
}

export type AnimationVideoJob = { id: string; status: string; finalContentUrl: string | null; errorCode: string | null; errorMessage: string | null; scenes: Array<{ sourceSceneId: string; order: number; status: string; durationSeconds: number; errorMessage: string | null; retryCount: number }> };
export async function getAnimationVideoJob(id: string) {
  const data = await request(`/api/animation-projects/${encodeURIComponent(id)}/video-job`);
  return (data as ResponsePayload & { job?: AnimationVideoJob }).job;
}
export async function retryAnimationVideoScene(id: string, sceneId: string) {
  await request(`/api/animation-projects/${encodeURIComponent(id)}/video-job/scenes/${encodeURIComponent(sceneId)}/retry`, { method: 'POST' });
}

export async function uploadAnimationReference(file: File) {
  const token = localStorage.getItem('chat_auth_token');
  const form = new FormData();
  form.append('images', file);
  const response = await safeFetch('/api/uploads/images', { method: 'POST', body: form, credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let data: { images?: Array<{ id?: string; imageId?: string }>; message?: string } = {};
  try { data = await response.json(); } catch { /* Converted to a useful request error below. */ }
  if (!response.ok) throw createChatRequestError(data.message || 'آپلود تصویر انجام نشد.', response.status, data);
  const imageId = data.images?.[0]?.id || data.images?.[0]?.imageId;
  if (!imageId) throw new Error('شناسهٔ تصویر مرجع دریافت نشد.');
  return imageId;
}
