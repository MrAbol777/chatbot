import { ChatMessage, UserProfile } from '../types';
import type { IconName } from '../components/Icon';

export type RecordingAction = 'idle' | 'confirm' | 'cancel';
export type LandingStep = 'landing' | 'login' | 'signup' | 'chat';
export type AppView = 'chat' | 'studio' | 'images' | 'video' | 'profile' | 'noa';

export type PersonalityProfile = {
  interests: string[];
  preferredStyle: 'formal' | 'casual' | 'playful';
  emotionState: 'happy' | 'sad' | 'neutral';
  messageCount: number;
  lastTopics: string[];
};

export type AuthMode = 'login' | 'signup';

export type ApiErrorData = {
  error?: string;
  message?: string;
  details?: string;
  redirectTo?: AuthMode | null;
  limit?: number;
  usage?: number;
  remaining?: number;
  nextAction?: string;
  retryAfter?: number;
  retryAfterSeconds?: number;
  actionKey?: string;
  balanceNoa?: string;
  requiredNoa?: string;
  shortfallNoa?: string;
};

export type AuthFamilyPayload = {
  child?: {
    id: string;
    name: string;
    age: number;
    avatar?: string | null;
    grade?: string | null;
    safetyLevel?: string;
  } | null;
  guardian?: {
    id?: string | null;
    phone?: string | null;
  } | null;
};

export type VerifyCodeResult = {
  success: boolean;
  isNewUser?: boolean;
  requiresProfile?: boolean;
  signupToken?: string;
  userId?: string;
  profile?: { name: string; age: number; phone: string };
  token?: string;
} & AuthFamilyPayload;

export type PhoneStatusResult = {
  success: boolean;
  exists: boolean;
  recommendedMode: AuthMode;
  redirectTo?: AuthMode | null;
};

export type ApiError = Error & {
  redirectTo?: AuthMode | null;
  status?: number;
  retryAfterSeconds?: number;
};

export type ChatRequestError = Error & { status?: number; payload?: ApiErrorData };

export type ChatImageIntentResponse = {
  intent?: 'chat' | 'image_generation' | 'image_edit' | 'image_understanding';
  status?: 'QUEUE' | 'WAITING' | 'RUNNING' | 'COMPLETED' | 'ERROR';
  assistantText?: string;
  taskId?: string;
  error?: string;
  reason?: string | null;
  blocked?: boolean;
  unsupported?: boolean;
  messages?: ChatMessage[];
  reply?: string;
  conversationId?: string;
  imageStudioRedirect?: boolean;
};

export type ChatStreamEvent = {
  type: 'meta' | 'delta' | 'done' | 'error' | 'cancelled' | 'title';
  status?: 'streaming' | 'completed' | 'cancelled' | 'failed';
  turnId: string;
  attemptId: string;
  intent?: 'chat' | 'image_understanding';
  delta?: string;
  reply?: string;
  conversationId?: string;
  error?: string;
  message?: string;
  retryable?: boolean;
  imageStudioRedirect?: boolean;
  title?: string;
  titleStatus?: 'completed' | 'fallback' | 'skipped';
};

export type ChatStreamPayload = {
  message: string;
  imageIds?: string[];
  history?: ChatMessage[];
  profile: UserProfile;
  personality: PersonalityProfile;
  conversationId?: string;
  clientMessageId?: string;
  turnId: string;
  attemptId: string;
};

export type AttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export type ImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  status: AttachmentStatus;
  imageId?: string;
  error?: string;
};

export type ImagePreviewState = {
  src: string;
  alt: string;
  downloadName: string;
};

export type SuggestionPrompt = {
  label: string;
  prompt: string;
  icon: IconName;
};
