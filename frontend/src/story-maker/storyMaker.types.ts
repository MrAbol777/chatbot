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

export type StoryVisualBible = { style: string; animationStyle: string; characterDesignLanguage: string; environmentDesignLanguage: string; colorLightingMood: string; consistencyRules: string };
export type StoryCharacter = { name: string; description: string; personality: string; specialAbility: string; relationship: string; visualSignature: string; goal: string; voiceStyle: string };
export type StoryLocation = { id: string; name: string; description: string; environmentDetails: string; timeWeather: string; lighting: string; continuityRules: string };
export type StoryProp = { id: string; name: string; description: string; ownerOrLocation: string; initialState: string; consistencyRules: string };
export type StoryScene = { number: number; title: string; duration: string; presentCharacters: string; emotion: string; goal: string; setting: string; visual: string; camera: string; action: string; dialogue: string; narration: string; reaction: string; sound: string; continuity: string; outcome: string; transition: string; imagePrompt: string };
export type StoryScenario = {
  schemaVersion?: 1 | 2;
  title: string;
  audience: string;
  duration: string;
  openingHook: string;
  logline: string;
  message: string;
  visualStyle: string;
  visualBible?: StoryVisualBible;
  world: string;
  characters: StoryCharacter[];
  locations?: StoryLocation[];
  props?: StoryProp[];
  storyBeats: { setup: string; goal: string; obstacle: string; climax: string; resolution: string };
  scenes: StoryScene[];
  ending: string;
};

export type StoryVersion = { id: string; createdAt: string; label: string; scenario: string; displayScenario?: string; story: StoryScenario };

export type StoryWorkspaceStatus = 'idea' | 'briefing' | 'preview' | 'generating' | 'completed' | 'error';
export type StoryWorkspace = {
  id: string;
  title: string;
  idea: string;
  status: StoryWorkspaceStatus;
  draft?: StoryDraft;
  brief?: StoryBrief | null;
  briefAnswers?: Record<string, string>;
  plan?: StoryPlanPreview | null;
  characterNames?: string[];
  characterDetails?: StoryAddedCharacter[];
  scenario?: string;
  displayScenario?: string;
  story?: StoryScenario | null;
  versions?: StoryVersion[];
  createdAt: string;
  updatedAt: string;
};
