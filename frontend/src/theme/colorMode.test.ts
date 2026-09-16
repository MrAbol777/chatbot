import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { COLOR_MODE_STORAGE_KEY, readStoredColorMode, getInitialColorMode, applyColorMode, persistColorMode } from './colorMode';

describe('colorMode utility', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-color-mode');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => vi.restoreAllMocks());

  it('accepts only the light preference', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    expect(readStoredColorMode()).toBeNull();
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'light');
    expect(readStoredColorMode()).toBe('light');
    expect(getInitialColorMode()).toBe('light');
  });

  it('coerces any legacy dark request to light', () => {
    applyColorMode('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists the light preference even when a legacy caller requests dark', () => {
    persistColorMode('dark');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
  });

  it('still applies light when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    persistColorMode('light');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
  });
});
