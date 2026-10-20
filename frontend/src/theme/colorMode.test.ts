import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { COLOR_MODE_STORAGE_KEY, readStoredColorMode, getInitialColorMode, applyColorMode, persistColorMode } from './colorMode';

describe('colorMode utility', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-color-mode');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => vi.restoreAllMocks());

  it('reads stored dark and light preferences', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    expect(readStoredColorMode()).toBe('dark');
    expect(getInitialColorMode()).toBe('dark');
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'light');
    expect(readStoredColorMode()).toBe('light');
    expect(getInitialColorMode()).toBe('light');
  });

  it('applies dark mode correctly', () => {
    applyColorMode('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('persists preferences correctly', () => {
    persistColorMode('dark');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');
  });

  it('still applies theme when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    persistColorMode('light');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
  });
});
