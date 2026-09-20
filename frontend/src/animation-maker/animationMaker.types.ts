export type AnimationStage = 'idea' | 'questions' | 'summary' | 'scenario' | 'characters' | 'storyboard' | 'video' | 'completed' | 'error';
export type AnimationStatus = 'draft' | 'active' | 'pending' | 'processing' | 'completed' | 'failed' | 'partial_failed' | 'cancelled' | 'scenario_approved' | 'characters_generating' | 'characters_review' | 'characters_approved' | 'storyboard_generating' | 'storyboard_review' | 'storyboard_approved' | 'video_queued' | 'video_processing';
export type AnimationStyle = 'animated' | 'three-dimensional' | 'realistic' | 'cinematic' | 'cartoon' | 'stop-motion';
export type AnimationAudience = 'preschool' | 'children' | 'preteen' | 'teen' | 'family';
export type AnimationMood = 'happy' | 'emotional' | 'adventure' | 'educational' | 'funny' | 'mystery';
export type AnimationAudio = 'narrator' | 'dialogue' | 'music' | 'subtitles' | 'silent';

export type AnimationProject = {
  id: string;
  schemaVersion: 1;
  title: string;
  stage: AnimationStage;
  status: AnimationStatus;
  currentStep: number;
  userInput: { idea: string; referenceImageIds: string[] };
  preferences: {
    durationSeconds: number;
    style: AnimationStyle | '';
    location: string;
    audience: AnimationAudience | '';
    aspectRatio: '9:16' | '16:9' | '1:1';
    mood: AnimationMood | '';
    audio: AnimationAudio[];
    referenceNote: string;
  };
  approvals: { scenario: boolean; characters: boolean; storyboard: boolean };
  revisions: Array<{ id: string; stage: AnimationStage; request: string; createdAt: string }>;
  sourceLinks: { storyWorkspaceId: string; characterWorkspaceId: string; storyboardWorkspaceId: string; videoGenerationId: string };
  review: { scenarioVersion: string; characterVersion: string; storyboardVersion: string; storyboardDurationSeconds: number; sceneIds: string[]; characterIds: string[]; locationIds: string[]; propIds: string[]; videoPayload: Record<string, unknown> | null };
  createdAt: string;
  updatedAt: string;
};

export type AnimationProjectSummary = Pick<AnimationProject, 'id' | 'title' | 'stage' | 'status' | 'createdAt' | 'updatedAt'> & { idea: string };
export type AnimationProjectInput = Omit<AnimationProject, 'id' | 'createdAt' | 'updatedAt'>;

export const createAnimationProjectInput = (idea: string): AnimationProjectInput => ({
  schemaVersion: 1,
  title: idea.trim().slice(0, 70) || 'فیلم تازه‌ی من',
  stage: 'questions',
  status: 'active',
  currentStep: 0,
  userInput: { idea: idea.trim(), referenceImageIds: [] },
  preferences: { durationSeconds: 10, style: '', location: '', audience: '', aspectRatio: '9:16', mood: '', audio: [], referenceNote: '' },
  approvals: { scenario: false, characters: false, storyboard: false },
  revisions: [],
  sourceLinks: { storyWorkspaceId: '', characterWorkspaceId: '', storyboardWorkspaceId: '', videoGenerationId: '' },
  review: { scenarioVersion: '', characterVersion: '', storyboardVersion: '', storyboardDurationSeconds: 0, sceneIds: [], characterIds: [], locationIds: [], propIds: [], videoPayload: null }
});
