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
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
