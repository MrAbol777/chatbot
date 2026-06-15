/**
 * Image service — public API facade.
 * Re-exports from imageGeneration.ts for convenient imports.
 */

export {
  startImageGeneration,
  getImageGenerationStatus,
  generateImageWithPolling
} from './imageGeneration';

export type { ImageTaskStatus, GenerateImageResponse, ImageStatusResponse } from './imageGeneration';
