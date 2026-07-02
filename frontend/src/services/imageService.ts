/**
 * Image service — public API facade.
 * Re-exports from imageGeneration.ts for convenient imports.
 */

export {
  startImageGeneration,
  getImageGenerationStatus,
  getImageGenerationStatusForConversation,
  fetchProtectedImageBlobUrl,
  generateImageWithPolling
} from './imageGeneration';

export type { ImageTaskStatus, GenerateImageResponse, ImageStatusResponse } from './imageGeneration';
