import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatApp, { resolveAuthenticatedProfile } from './App';
import { ToastProvider } from './design-system/components';

const cachedProfile = {
  id: 'cached-user',
  name: 'کاربر ذخیره‌شده',
  age: 12,
  phone: '09120000000',
  personality: {
    interests: ['نقاشی'],
    preferredStyle: 'playful' as const,
    emotionState: 'happy' as const,
    messageCount: 4,
    lastTopics: ['رنگ']
  }
};

describe('authenticated profile resolution', () => {
  it('never promotes a cached profile when the server session is unauthenticated', () => {
    expect(resolveAuthenticatedProfile({ authenticated: false }, cachedProfile)).toBeNull();
  });

  it('preserves a valid OTP bearer session and uses the server identity', () => {
    expect(resolveAuthenticatedProfile({
      authenticated: true,
      provider: 'otp',
      authMethods: ['bearer'],
      userId: 'otp-user',
      profile: { id: 'otp-user', name: 'کاربر OTP', age: 14, phone: '09121111111' }
    }, cachedProfile)).toEqual(expect.objectContaining({
      id: 'otp-user',
      name: 'کاربر OTP',
      authProvider: 'otp',
      personality: cachedProfile.personality
    }));
  });

  it('preserves a valid Viana cookie session and uses the server identity', () => {
    expect(resolveAuthenticatedProfile({
      authenticated: true,
      provider: 'viana',
      authMethods: ['session'],
      userId: 'viana-user',
      profile: { id: 'viana-user', name: 'کاربر ویانا', age: 15 }
    }, cachedProfile)).toEqual(expect.objectContaining({
      id: 'viana-user',
      name: 'کاربر ویانا',
      authProvider: 'viana'
    }));
  });
});

describe('session bootstrap rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/chat');
  });

  it('shows recovery UI, never the chat shell, for a cached profile with a rejected bearer', async () => {
    localStorage.setItem('chat_profile', JSON.stringify(cachedProfile));
    localStorage.setItem('chat_auth_token', 'expired-token');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/session') {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/auth/viana/config') {
        return new Response(JSON.stringify({ enabled: false, providerLabel: 'Viana' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/settings/public') {
        return new Response(JSON.stringify({ settings: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    const { container } = render(createElement(ToastProvider, null, createElement(ChatApp)));

    await screen.findByText('در این مرورگر یک حساب ذخیره شده است؛ برای بازیابی گفتگوها همان شماره را وارد کن.');
    expect(container.querySelector('.auth-shell')).toBeInTheDocument();
    expect(container.querySelector('.chat-shell')).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('chat_auth_token')).toBeNull());
    expect(localStorage.getItem('chat_profile')).not.toBeNull();
  });
});
