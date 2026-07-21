import { TERMINAL_VIDEO_STATUSES } from './video-generation.constants';
import type { VideoGenerationStatus } from './video-generation.types';

export const normalizeVideoStatus = (value: string | undefined): VideoGenerationStatus => {
  const known: VideoGenerationStatus[] = ['queued', 'submitting', 'submitted', 'processing', 'storing', 'succeeded', 'failed', 'cancelled', 'expired'];
  return known.includes(value as VideoGenerationStatus) ? value as VideoGenerationStatus : 'unknown';
};
export const isTerminalVideoStatus = (value: string | undefined) => TERMINAL_VIDEO_STATUSES.has(normalizeVideoStatus(value));
export const formatVideoDate = (value?: string) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export const promptPreview = (value?: string) => value ? `${value.slice(0, 110)}${value.length > 110 ? '…' : ''}` : 'بدون توضیحات';
export const newIdempotencyKey = () => crypto.randomUUID();
export const formatElapsed = (createdAt?: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt || Date.now()).getTime()) / 1000));
  return seconds < 60 ? 'کمتر از یک دقیقه' : `${Math.floor(seconds / 60).toLocaleString('fa-IR')} دقیقه`;
};
