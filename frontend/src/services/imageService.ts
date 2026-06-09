/**
 * Image service — public API facade.
 * Re-exports from imageGeneration.ts for convenient imports.
 */

export {
  generateImage,
  getImageStatus,
  generateImageWithPolling
} from './imageGeneration';

export type { ImageTaskStatus, GenerateImageResponse, ImageStatusResponse } from './imageGeneration';
