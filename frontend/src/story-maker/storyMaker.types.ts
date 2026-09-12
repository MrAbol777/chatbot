export type StoryMood = 'funny' | 'adventure' | 'magical' | 'mystery';
export type StoryPlace = 'school' | 'forest' | 'space' | 'underwater' | 'future-city' | 'custom';
export type StoryLength = 'short' | 'medium' | 'long' | 'custom';
export type StoryEnding = 'happy' | 'surprising' | 'heroic' | 'choose-for-me' | 'custom';

export type StoryDraft = {
  idea: string;
  heroName: string;
  companionName: string;
  mood: StoryMood;
  place: StoryPlace;
  customPlace: string;
  length: StoryLength;
  customSceneCount: string;
  ending: StoryEnding;
  customEnding: string;
};

export type ScenarioPromptPayload = {
  version: '1.0';
  locale: 'fa-IR';
  format: 'animated_storyboard';
  draft: StoryDraft;
  output: {
    scenes: number;
    include: Array<'title' | 'world' | 'characters' | 'scenes' | 'dialogue' | 'narration' | 'ending'>;
  };
};

export type StoryClarificationQuestion = {
  id: string;
  question: string;
  hint: string;
  options: string[];
};

export type StoryBrief = {
  status: 'ready' | 'needs_clarification';
  summary: string;
  resolvedDetails: Array<{ label: string; value: string }>;
  assumptions: Array<{ label: string; value: string }>;
  questions: StoryClarificationQuestion[];
};

export type StoryPlanCharacter = { name: string; role: string; description: string };
export type StoryAddedCharacter = { name: string; role: string; purpose: string };
export type StoryPlanPreview = {
  title: string;
  overview: string;
  world: string;
  tone: string;
  format: string;
  duration: string;
  characters: StoryPlanCharacter[];
  storyPath: { beginning: string; challenge: string; climax: string; resolution: string };
};

export type StoryContext = Pick<StoryBrief, 'summary' | 'resolvedDetails' | 'assumptions'> & {
  answers: Record<string, string>;
  characterNames?: string[];
  characterDetails?: StoryAddedCharacter[];
};

export type StoryCharacter = { name: string; description: string; goal: string; voiceStyle: string };
export type StoryScene = { number: number; title: string; goal: string; setting: string; visual: string; camera: string; action: string; dialogue: string; narration: string; sound: string; continuity: string; transition: string; imagePrompt: string };
export type StoryScenario = {
  title: string;
  logline: string;
  message: string;
  visualStyle: string;
  world: string;
  characters: StoryCharacter[];
  storyBeats: { setup: string; goal: string; obstacle: string; climax: string; resolution: string };
  scenes: StoryScene[];
  ending: string;
};

export type StoryVersion = { id: string; createdAt: string; label: string; scenario: string; story: StoryScenario };
