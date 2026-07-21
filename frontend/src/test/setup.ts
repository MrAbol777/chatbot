import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());
Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((media: string) => ({ matches: false, media, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverMock });
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });

// Fail closed: tests must install their own controlled fetch response.
vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { throw new Error(`Unmocked test request: ${String(input)}`); }));
