import type { ScenarioPromptPayload, StoryDraft } from './storyMaker.types';

const sceneCount = { short: 3, medium: 5, long: 8 } as const;

/**
 * The page creates a stable creative brief. The future Agent endpoint turns
 * this into its private prompt before calling the scenario-generation API.
 */
export function buildScenarioPromptPayload(draft: StoryDraft): ScenarioPromptPayload {
  const requestedSceneCount = Number.parseInt(draft.customSceneCount, 10);
  const scenes = draft.length === 'custom'
    ? Math.max(2, Math.min(10, Number.isFinite(requestedSceneCount) ? requestedSceneCount : 5))
    : sceneCount[draft.length];
  return {
    version: '1.0',
    locale: 'fa-IR',
    format: 'animated_storyboard',
    draft,
    output: {
      scenes,
      include: ['title', 'world', 'characters', 'scenes', 'dialogue', 'narration', 'ending']
    }
  };
}
