export type CharacterImageState = {
  taskId?: string;
  status?: 'idle' | 'QUEUE' | 'WAITING' | 'RUNNING' | 'COMPLETED' | 'ERROR';
  imageUrl?: string | null;
  previousImageUrl?: string | null;
  operation?: 'generate' | 'edit';
  error?: string | null;
};

export type CharacterProfile = {
  id: string;
  name: string;
  role: string;
  archetype: string;
  personality: string;
  relationshipNote: string;
  identityLock: string;
  appearance: string;
  wardrobe: string;
  mannerism: string;
  palette: string;
  imagePrompt: string;
  negativePrompt: string;
  image?: CharacterImageState;
};

export type StorySetting = {
  name: string;
  description: string;
  imagePrompt: string;
  negativePrompt: string;
  image?: CharacterImageState;
};

export type CharacterAnalysis = {
  title: string;
  summary: string;
  visualStyle: string;
  relationships: Array<{ from: string; to: string; label: string }>;
  characters: CharacterProfile[];
  setting: StorySetting;
};

export type CharacterWorkspaceStatus = 'review' | 'generating' | 'completed' | 'error';
export type CharacterWorkspace = {
  id: string;
  title: string;
  scenario: string;
  status: CharacterWorkspaceStatus;
  analysis?: CharacterAnalysis;
  createdAt: string;
  updatedAt: string;
};
