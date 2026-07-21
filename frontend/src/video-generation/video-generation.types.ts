export type VideoGenerationMode = 'text-to-video' | 'image-to-video';
export type VideoGenerationStatus = 'queued' | 'submitting' | 'submitted' | 'processing' | 'storing' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'unknown';

export type VideoGenerationOption = {
  internalKey: string;
  displayNameFa: string;
  displayName?: string | null;
  descriptionFa?: string | null;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  allowedAspectRatios: string[];
  allowedDurations: string[];
  allowedQualities: string[];
  maxPromptLength: number | null;
  quotaUnits: number;
};

export type VideoGenerationOptions = { models: VideoGenerationOption[]; enabled?: boolean };
export type VideoGenerationResult = { contentUrl: string; downloadUrl: string; mimeType?: string | null; sizeBytes?: number | null; storedAt?: string | null };
export type VideoGenerationListItem = {
  id: string; mode: VideoGenerationMode; model_key: string; status: VideoGenerationStatus | string;
  prompt?: string; aspect_ratio?: string; duration?: string; quality?: string;
  safe_error_code?: string | null; safe_error_message?: string | null;
  created_at: string; updated_at?: string; completed_at?: string | null; result?: VideoGenerationResult | null;
};
export type VideoGenerationDetail = VideoGenerationListItem & { result_storage_key?: never; provider_job_id?: never; provider?: never };
export type VideoGenerationPagination = { nextCursor: string | null };
export type VideoSubmitInput = { mode: 'text-to-video'; modelKey: string; prompt: string; aspectRatio: string; duration: string; quality: string };
export type VideoGenerationErrorCode =
  | 'VIDEO_GENERATION_DISABLED' | 'VIDEO_MODEL_NOT_AVAILABLE' | 'VIDEO_GENERATION_MODEL_UNAVAILABLE'
  | 'VIDEO_SUBSCRIPTION_REQUIRED' | 'VIDEO_PLAN_NOT_ACTIVE' | 'VIDEO_QUOTA_NOT_CONFIGURED' | 'VIDEO_QUOTA_EXCEEDED'
  | 'VIDEO_INVALID_SETTINGS' | 'VIDEO_GENERATION_OPTIONS_NOT_ALLOWED' | 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT'
  | 'VIDEO_PROVIDER_UNAVAILABLE' | 'VIDEO_PROVIDER_SUBMIT_FAILED' | 'VIDEO_GENERATION_FAILED'
  | 'VIDEO_GENERATION_NOT_FOUND' | 'VIDEO_RESULT_NOT_READY' | 'VIDEO_RESULT_FILE_MISSING'
  | 'VIDEO_GENERATION_LOGIN_REQUIRED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
export type VideoGenerationError = Error & { code: VideoGenerationErrorCode; status?: number };
export type VideoSubmitResult = { generationId: string; status: VideoGenerationStatus | string; quotaUnitsReserved: number; createdAt: string };
