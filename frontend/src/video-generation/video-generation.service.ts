import { createVideoGenerationError } from './video-generation.errors';
import type { VideoGenerationDetail, VideoGenerationListItem, VideoGenerationOptions, VideoSubmitInput, VideoSubmitResult } from './video-generation.types';

const authHeaders = () => {
  try { const token = localStorage.getItem('chat_auth_token'); return token ? { Authorization: `Bearer ${token}` } : {}; } catch { return {}; }
};

type Validator<T> = (body: unknown) => body is T;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInternalContentUrl = (value: unknown) => typeof value === 'string' && /^\/api\/video-generations\/[^/?]+\/content(?:\?download=1)?$/.test(value);
const isOptions = (value: unknown): value is VideoGenerationOptions => isRecord(value) && Array.isArray(value.models) && value.models.every((model) => isRecord(model) && typeof model.internalKey === 'string' && typeof model.displayNameFa === 'string' && Array.isArray(model.allowedAspectRatios) && Array.isArray(model.allowedDurations) && Array.isArray(model.allowedQualities) && (typeof model.maxPromptLength === 'number' || model.maxPromptLength === null) && typeof model.quotaUnits === 'number');
const isList = (value: unknown): value is { items: VideoGenerationListItem[] } => isRecord(value) && Array.isArray(value.items);
const isDetail = (value: unknown): value is VideoGenerationDetail => isRecord(value) && typeof value.id === 'string' && typeof value.status === 'string' && typeof value.created_at === 'string';
const isSubmit = (value: unknown): value is VideoSubmitResult => isRecord(value) && typeof value.generationId === 'string' && typeof value.status === 'string';
const isContentAuth = (value: unknown): value is { contentUrl: string; downloadUrl: string } => isRecord(value) && isInternalContentUrl(value.contentUrl) && isInternalContentUrl(value.downloadUrl);

async function request<T>(url: string, validator: Validator<T>, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  Object.entries(authHeaders()).forEach(([name, value]) => headers.set(name, value));
  let response: Response;
  try { response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init, headers }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw createVideoGenerationError('NETWORK_ERROR'); }
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = body && typeof body === 'object' ? body as { error?: string } : {};
    throw createVideoGenerationError(payload.error, response.status);
  }
  if (!validator(body)) throw createVideoGenerationError();
  return body;
}

export const videoGenerationService = {
  getVideoOptions: (signal?: AbortSignal) => request('/api/video-generation/options', isOptions, { signal }),
  createVideoGeneration: (input: VideoSubmitInput, idempotencyKey: string, signal?: AbortSignal) => request('/api/video-generations', isSubmit, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) }),
  listVideoGenerations: (signal?: AbortSignal) => request('/api/video-generations', isList, { signal }),
  getVideoGeneration: (generationId: string, signal?: AbortSignal) => request(`/api/video-generations/${encodeURIComponent(generationId)}`, isDetail, { signal }),
  prepareVideoContent: (generationId: string, signal?: AbortSignal) => request(`/api/video-generations/${encodeURIComponent(generationId)}/content-auth`, isContentAuth, { signal }),
  getVideoContentUrl: (generationId: string) => `/api/video-generations/${encodeURIComponent(generationId)}/content`,
  getVideoDownloadUrl: (generationId: string) => `/api/video-generations/${encodeURIComponent(generationId)}/content?download=1`
};
