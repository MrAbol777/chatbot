import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COLOR_MODE_STORAGE_KEY,
  readStoredColorMode,
  getSystemColorMode,
  getInitialColorMode,
  applyColorMode,
  persistColorMode
} from './colorMode';

describe('colorMode utility', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-color-mode');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads stored color mode correctly', () => {
    expect(readStoredColorMode()).toBeNull();

    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    expect(readStoredColorMode()).toBe('dark');

    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'light');
    expect(readStoredColorMode()).toBe('light');

    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'invalid-value');
    expect(readStoredColorMode()).toBeNull();
  });

  it('handles localStorage read errors gracefully', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readStoredColorMode()).toBeNull();
  });

  it('detects system color mode using matchMedia', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    expect(getSystemColorMode()).toBe('dark');

    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    expect(getSystemColorMode()).toBe('light');
  });

  it('prioritizes stored mode over system preference in getInitialColorMode', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    // No stored mode -> use system (dark)
    expect(getInitialColorMode()).toBe('dark');

    // Stored mode = light -> use light even though system is dark
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'light');
    expect(getInitialColorMode()).toBe('light');
  });

  it('applies color mode attribute and color-scheme style to html root', () => {
    applyColorMode('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyColorMode('light');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists color mode to localStorage and applies it', () => {
    persistColorMode('dark');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');

    persistColorMode('light');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
  });

  it('handles localStorage write errors gracefully during persistColorMode', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    // Should not throw, should still apply attribute
    persistColorMode('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');
  });
});
