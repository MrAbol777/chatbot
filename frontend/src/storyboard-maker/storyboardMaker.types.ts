export type StoryboardCharacterReference = {
  id: string;
  name: string;
  file: File;
  previewUrl: string;
  sourceKey?: string;
};

export type StoryboardScene = {
  id: string;
  number: number;
  title: string;
  description: string;
  setting: string;
  action: string;
  dialogue: string;
  camera: string;
  mood: string;
  characterIds: string[];
  imagePrompt: string;
  negativePrompt: string;
  sourceSceneId?: string;
  locationIds?: string[];
  propIds?: string[];
  durationSeconds?: number;
};

export type StoryboardPlan = {
  title: string;
  summary: string;
  visualStyle: string;
  scenes: StoryboardScene[];
};

export type StoryboardSceneState = StoryboardScene & {
  status: 'idle' | 'generating' | 'completed' | 'error';
  imageUrl?: string;
  imageJobId?: string;
  error?: string;
};

export type StoryboardWorkspaceStatus = 'review' | 'generating' | 'completed' | 'error';

export type StoryboardWorkspace = {
  id: string;
  title: string;
  script: string;
  status: StoryboardWorkspaceStatus;
  characters?: Array<{ id: string; name: string }>;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  plan?: StoryboardPlan;
  overviewImageUrl?: string;
  scenes?: StoryboardSceneState[];
  createdAt: string;
  updatedAt: string;
};
