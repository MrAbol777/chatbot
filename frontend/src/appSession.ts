import { UserProfile } from './types';
import { createDefaultPersonality, normalizePersonality } from './services/chatStream';
import type { DanoaSessionResponse } from './auth/danoaSession';

export const PROFILE_KEY = 'chat_profile';

export type AppProfile = UserProfile & {
  id?: number | string;
  authProvider?: 'otp' | 'viana';
};

export const loadProfile = (): AppProfile | null => {
  try {
    const rawProfile = localStorage.getItem(PROFILE_KEY);
    if (!rawProfile) return null;

    const parsed = JSON.parse(rawProfile) as Partial<AppProfile>;
    if (!parsed?.name || typeof parsed.name !== 'string' || !Number.isFinite(Number(parsed.age))) {
      return null;
    }

    return {
      ...parsed,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'کاربر',
      age: Number(parsed.age),
      personality: normalizePersonality(parsed.personality)
    };
  } catch (error) {
    console.error('[profile] Failed to load profile:', error);
    return null;
  }
};

export const resolveAuthenticatedProfile = (
  serverSession: DanoaSessionResponse,
  cachedProfile: AppProfile | null
): AppProfile | null => {
  if (!serverSession.authenticated || !serverSession.profile || !serverSession.userId) {
    return null;
  }

  return {
    ...serverSession.profile,
    id: serverSession.userId,
    authProvider: serverSession.provider,
    personality: cachedProfile?.personality || createDefaultPersonality()
  };
};
