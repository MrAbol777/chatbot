export type AuthNotice = 'success' | 'denied' | 'invalid_or_expired' | 'temporary_error' | 'failed' | 'disabled';

export type DanoaSessionResponse = {
  authenticated: boolean;
  provider?: 'otp' | 'viana';
  authMethods?: Array<'session' | 'bearer'>;
  userId?: string;
  profile?: {
    id: string;
    name: string;
    age: number;
    phone?: string;
    grade?: string | null;
    gender?: 'MALE' | 'FEMALE' | null;
  };
  csrfToken?: string;
  authNotice?: AuthNotice;
  error?: string;
};

let csrfToken = '';
let fetchInstalled = false;

const isUnsafeMethod = (method: string) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

const isSameOriginRequest = (input: RequestInfo | URL) => {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

export function setSessionCsrfToken(value?: string) {
  csrfToken = typeof value === 'string' ? value : '';
}

export function clearSessionCsrfToken() {
  csrfToken = '';
}

export function installAuthenticatedFetch() {
  if (fetchInstalled || typeof window === 'undefined') return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!csrfToken || !isUnsafeMethod(method) || !isSameOriginRequest(input)) {
      return originalFetch(input, init);
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken);
    return originalFetch(input, { ...init, headers });
  };
  fetchInstalled = true;
}

async function readSession(headers?: HeadersInit): Promise<DanoaSessionResponse> {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include',
    headers
  });
  let body: DanoaSessionResponse = { authenticated: false };
  try {
    body = (await response.json()) as DanoaSessionResponse;
  } catch {
    body = { authenticated: false };
  }
  if (!response.ok && response.status !== 401) {
    throw new Error('SESSION_LOOKUP_FAILED');
  }
  return body;
}

export async function loadDanoaSession(storedBearer = ''): Promise<DanoaSessionResponse> {
  const cookieOnly = await readSession();
  if (cookieOnly.authenticated || !storedBearer) {
    if (cookieOnly.csrfToken) setSessionCsrfToken(cookieOnly.csrfToken);
    return cookieOnly;
  }
  const bearerOnly = await readSession({ Authorization: `Bearer ${storedBearer}` });
  return {
    ...bearerOnly,
    authNotice: cookieOnly.authNotice || bearerOnly.authNotice
  };
}

export async function loadVianaConfig(): Promise<{ enabled: boolean; providerLabel: string }> {
  const response = await fetch('/api/auth/viana/config', { credentials: 'include' });
  if (!response.ok) return { enabled: false, providerLabel: 'Viana' };
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    console.warn('[auth] viana config returned a non-JSON response', { status: response.status, contentType });
    return { enabled: false, providerLabel: 'Viana' };
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return { enabled: false, providerLabel: 'Viana' };
  return {
    enabled: body?.enabled === true,
    providerLabel: typeof body?.providerLabel === 'string' ? body.providerLabel : 'Viana'
  };
}

export const authNoticeMessage = (notice?: AuthNotice) => {
  if (notice === 'denied') return { variant: 'help' as const, text: 'ورود با Viana لغو شد؛ حساب فعلی شما تغییری نکرد.' };
  if (notice === 'invalid_or_expired') {
    return { variant: 'error' as const, text: 'فرصت این تلاش ورود تمام شده است. لطفاً دوباره شروع کنید.' };
  }
  if (notice === 'temporary_error') {
    return { variant: 'error' as const, text: 'Viana موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.' };
  }
  if (notice === 'failed') return { variant: 'error' as const, text: 'ورود با Viana کامل نشد. لطفاً دوباره تلاش کنید.' };
  if (notice === 'disabled') return { variant: 'help' as const, text: 'ورود با Viana فعلاً فعال نیست.' };
  return null;
};
