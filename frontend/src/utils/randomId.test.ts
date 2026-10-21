import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './randomId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the page is a secure context', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(randomUuid()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('falls back to getRandomValues on plain HTTP, where randomUUID is undefined', () => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => { array.fill(0xab); return array; } });
    const id = randomUuid();
    expect(id).toMatch(UUID_V4);
    expect(randomUuid()).toBe(id);
  });

  it('still returns a valid id when no crypto API exists, and ids differ', () => {
    vi.stubGlobal('crypto', undefined);
    const first = randomUuid();
    expect(first).toMatch(UUID_V4);
    expect(randomUuid()).not.toBe(first);
  });

  it('produces ids accepted by the chat stream id pattern', () => {
    vi.stubGlobal('crypto', {});
    expect(`turn-${randomUuid()}`).toMatch(/^[0-9a-zA-Z][0-9a-zA-Z._:-]{7,63}$/);
  });
});
