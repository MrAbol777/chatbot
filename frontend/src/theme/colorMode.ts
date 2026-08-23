export type ColorMode = 'light' | 'dark';

export const COLOR_MODE_STORAGE_KEY = 'danoa_color_mode';

export function readStoredColorMode(): ColorMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch (error) {
    console.warn('[colorMode] Failed to read stored color mode:', error);
  }
  return null;
}

export function getSystemColorMode(): ColorMode {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // fallback to light
    }
  }
  return 'light';
}

export function getInitialColorMode(): ColorMode {
  const stored = readStoredColorMode();
  if (stored) {
    return stored;
  }
  return getSystemColorMode();
}

export function applyColorMode(mode: ColorMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-color-mode', mode);
  root.style.colorScheme = mode;
}

export function persistColorMode(mode: ColorMode): void {
  applyColorMode(mode);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('[colorMode] Failed to persist color mode to localStorage:', error);
  }
}

// Apply early to avoid flash
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  applyColorMode(getInitialColorMode());
}
