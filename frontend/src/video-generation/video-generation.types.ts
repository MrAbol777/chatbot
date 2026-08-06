export type VideoGenerationMode = 'text-to-video' | 'image-to-video';
export type VideoGenerationStatus = 'queued' | 'routing' | 'submitting' | 'submitted' | 'processing' | 'storing' | 'provider_status_unknown' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'unknown';

export type VideoGenerationOption = {
  internalKey: string;
  displayNameFa: string;
  displayName?: string | null;
  descriptionFa?: string | null;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsNegativePrompt?: boolean;
  supportsAudio?: boolean;
  capability?: 'video.text_to_video' | 'video.image_to_video';
  allowedAspectRatios: string[];
  allowedDurations: string[];
  allowedQualities: string[];
  allowedResolutions?: string[];
  maxPromptLength: number | null;
};

export type VideoCapabilityOption = {
  allowedAspectRatios: string[];
  allowedDurations: string[];
  allowedQualities: string[];
  allowedResolutions: string[];
  maxPromptLength: number | null;
  supportsNegativePrompt?: boolean;
  supportsAudio?: boolean;
  maxReferences?: number;
  minReferences?: number;
  supportsImageToVideoMulti?: boolean;
};
export type VideoPromptProfile = { id: string; profileKey: 'cinematic' | 'animation' | string; displayName: string; publicDescription: string; visualKey: string; displayOrder: number; currentVersion: number | null; checksum?: string | null };
export type VideoNoaPricing = { actionKey: 'video_generation'; unit: 'second'; quantity: string; unitPriceNoa: string; amountNoa: string; pricingVersion: number };
export type VideoGenerationOptions = { models?: VideoGenerationOption[]; enabled?: boolean; capabilities?: Record<string, VideoCapabilityOption>; promptProfiles?: VideoPromptProfile[]; pricing?: VideoNoaPricing; multiPricing?: VideoNoaPricing | null };
export type VideoGenerationResult = { contentUrl: string; downloadUrl: string; mimeType?: string | null; sizeBytes?: number | null; storedAt?: string | null };
export type VideoGenerationListItem = {
  id: string; mode: VideoGenerationMode; model_key?: string; status: VideoGenerationStatus | string;
  prompt?: string; aspect_ratio?: string; duration?: string; quality?: string;
  safe_error_code?: string | null; safe_error_message?: string | null; safeErrorCode?: string | null; safeErrorMessage?: string | null;
  created_at: string; updated_at?: string; completed_at?: string | null; result?: VideoGenerationResult | null;
};
export type VideoGenerationDetail = VideoGenerationListItem & { result_storage_key?: never; provider_job_id?: never; provider?: never };
export type VideoGenerationPagination = { nextCursor: string | null };
export type MultiImageState = {
  localId: string;
  file?: File | null;
  previewUrl?: string | null;
  fileName: string;
  uploadStatus: 'pending' | 'uploading' | 'ready' | 'error';
  mediaId?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadError?: string | null;
};
export type VideoSubmitInput = {
  mode: VideoGenerationMode | 'image_to_video';
  styleKey: string;
  mediaId?: string | null;
  mediaIds?: string[] | null;
  prompt: string;
  aspectRatio: string;
  duration: string;
  resolution: string;
};
export type VideoInputMedia = { mediaId: string; mimeType: string; sizeBytes: number };
export type VideoGenerationErrorCode =
  | 'VIDEO_GENERATION_DISABLED' | 'VIDEO_MODEL_NOT_AVAILABLE' | 'VIDEO_GENERATION_MODEL_UNAVAILABLE'
  | 'NOA_INSUFFICIENT_FUNDS' | 'NOA_PRICING_UNAVAILABLE'
  | 'VIDEO_INVALID_SETTINGS' | 'VIDEO_GENERATION_OPTIONS_NOT_ALLOWED' | 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT'
  | 'VIDEO_PROVIDER_UNAVAILABLE' | 'VIDEO_PROVIDER_SUBMIT_FAILED' | 'VIDEO_PROVIDER_INVALID_REQUEST' | 'VIDEO_PROVIDER_INSUFFICIENT_CREDITS'
  | 'VIDEO_PROVIDER_RATE_LIMITED' | 'VIDEO_PROVIDER_AUTH_FAILED' | 'VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG' | 'VIDEO_GENERATION_FAILED'
  | 'VIDEO_GENERATION_NOT_FOUND' | 'VIDEO_RESULT_NOT_READY' | 'VIDEO_RESULT_FILE_MISSING'
  | 'VIDEO_INPUT_MEDIA_REQUIRED' | 'VIDEO_INPUT_MEDIA_INVALID' | 'VIDEO_INPUT_MEDIA_UPLOAD_FAILED' | 'VIDEO_PROVIDER_STATUS_UNKNOWN'
  | 'VIDEO_GENERATION_LOGIN_REQUIRED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR'
  | 'VIDEO_GENERATION_INVALID_MEDIA_IDS' | 'VIDEO_GENERATION_TOO_MANY_MEDIA' | 'VIDEO_GENERATION_DUPLICATE_MEDIA' | 'VIDEO_GENERATION_INVALID_MEDIA';
export type VideoGenerationError = Error & { code: VideoGenerationErrorCode; status?: number };
export type VideoSubmitResult = { generationId: string; status: VideoGenerationStatus | string; noaReservationId: string; costNoa: string; unitPriceNoa: string; durationSeconds: string; createdAt: string };
