import { describe, expect, it } from 'vitest';
import { createVideoGenerationError } from './video-generation.errors';

describe('safe video-generation error mapping', () => {
  it.each(['VIDEO_GENERATION_DISABLED', 'VIDEO_MODEL_NOT_AVAILABLE', 'NOA_INSUFFICIENT_FUNDS', 'NOA_PRICING_UNAVAILABLE', 'VIDEO_INVALID_SETTINGS', 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT', 'VIDEO_PROVIDER_UNAVAILABLE', 'VIDEO_GENERATION_FAILED', 'VIDEO_GENERATION_NOT_FOUND', 'VIDEO_RESULT_NOT_READY', 'VIDEO_RESULT_FILE_MISSING'])('maps %s to a Persian message without provider data', (code) => {
    const error = createVideoGenerationError(code);
    expect(error.code).toBe(code); expect(error.message).toMatch(/[آ-ی]/); expect(error.message).not.toMatch(/stack|provider|https?:\/\//i);
  });
  it('maps unknown values to the generic safe message', () => {
    const error = createVideoGenerationError('provider secret: abc');
    expect(error.code).toBe('UNKNOWN_ERROR'); expect(error.message).not.toMatch(/secret|abc/i);
  });
});
