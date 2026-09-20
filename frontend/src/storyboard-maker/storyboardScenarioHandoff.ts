export type StoryboardScenarioHandoff = {
  scenario: string;
  title: string;
  animationProjectId?: string;
  storyWorkspaceId?: string;
  characterWorkspaceId?: string;
  scenarioVersion?: string;
  durationSeconds?: number;
};

const HANDOFF_KEY = 'danoa:storyboard-maker:scenario-handoff:v1';

export function saveStoryboardScenarioHandoff(scenario: string, title = '', animation?: Omit<StoryboardScenarioHandoff, 'scenario' | 'title'>) {
  const cleanScenario = scenario.trim().slice(0, 12000);
  if (!cleanScenario) return;
  const payload: StoryboardScenarioHandoff = {
    scenario: cleanScenario,
    title: title.trim().slice(0, 120),
    ...(animation?.animationProjectId?.trim() ? { animationProjectId: animation.animationProjectId.trim().slice(0, 64) } : {}),
    ...(animation?.storyWorkspaceId?.trim() ? { storyWorkspaceId: animation.storyWorkspaceId.trim().slice(0, 64) } : {}),
    ...(animation?.characterWorkspaceId?.trim() ? { characterWorkspaceId: animation.characterWorkspaceId.trim().slice(0, 64) } : {}),
    ...(animation?.scenarioVersion?.trim() ? { scenarioVersion: animation.scenarioVersion.trim().slice(0, 64) } : {}),
    ...(Number.isInteger(animation?.durationSeconds) ? { durationSeconds: Math.max(2, Math.min(180, Number(animation?.durationSeconds))) } : {})
  };
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    // A blocked storage area must not interrupt the flow.
  }
}

export function readStoryboardScenarioHandoff(): StoryboardScenarioHandoff | null {
  try {
    const value = JSON.parse(localStorage.getItem(HANDOFF_KEY) || '{}');
    const scenario = typeof value.scenario === 'string' ? value.scenario.trim().slice(0, 12000) : '';
    if (!scenario) return null;
    return {
      scenario,
      title: typeof value.title === 'string' ? value.title.trim().slice(0, 120) : '',
      ...(typeof value.animationProjectId === 'string' && value.animationProjectId.trim() ? { animationProjectId: value.animationProjectId.trim().slice(0, 64) } : {}),
      ...(typeof value.storyWorkspaceId === 'string' && value.storyWorkspaceId.trim() ? { storyWorkspaceId: value.storyWorkspaceId.trim().slice(0, 64) } : {}),
      ...(typeof value.characterWorkspaceId === 'string' && value.characterWorkspaceId.trim() ? { characterWorkspaceId: value.characterWorkspaceId.trim().slice(0, 64) } : {}),
      ...(typeof value.scenarioVersion === 'string' && value.scenarioVersion.trim() ? { scenarioVersion: value.scenarioVersion.trim().slice(0, 64) } : {}),
      ...(Number.isInteger(value.durationSeconds) ? { durationSeconds: Math.max(2, Math.min(180, Number(value.durationSeconds))) } : {})
    };
  } catch {
    return null;
  }
}
