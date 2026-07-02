// frontend/src/types.ts

export interface UserProfile {
  name: string;
  age: number;
  phone?: string;
  personality?: {
    interests: string[];
    preferredStyle: 'formal' | 'casual' | 'playful';
    emotionState: 'happy' | 'sad' | 'neutral';
    messageCount: number;
    lastTopics: string[];
  };
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  type?: 'text' | 'image_loading' | 'image_result' | 'image_error';
  intent?: 'chat' | 'image_generation' | 'image_edit';
  content: string;
  timestamp: string;
  taskId?: string;
  imageTaskId?: string;
  status?: 'QUEUE' | 'WAITING' | 'RUNNING' | 'COMPLETED' | 'ERROR' | 'CANCELLED';
  imageUrl?: string;
  resultUrl?: string;
  images?: Array<{
    url: string;
    alt?: string;
  }>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
