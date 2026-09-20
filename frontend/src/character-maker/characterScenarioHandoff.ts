export type CharacterScenarioHandoff = {
  scenario: string;
  title: string;
  createdAt: string;
  animationProjectId?: string;
  storyWorkspaceId?: string;
  scenarioVersion?: string;
  durationSeconds?: number;
};

const HANDOFF_KEY = 'danoa:character-maker:scenario-handoff:v1';

const cleanText = (value: unknown, maxLength: number) => typeof value === 'string'
  ? value.trim().slice(0, maxLength)
  : '';

export function saveCharacterScenarioHandoff(scenario: string, title = '', animation?: Pick<CharacterScenarioHandoff, 'animationProjectId' | 'storyWorkspaceId' | 'scenarioVersion' | 'durationSeconds'>) {
  const cleanScenario = cleanText(scenario, 8000);
  if (!cleanScenario) return;
  localStorage.setItem(HANDOFF_KEY, JSON.stringify({
    scenario: cleanScenario,
    title: cleanText(title, 120),
    createdAt: new Date().toISOString(),
    animationProjectId: cleanText(animation?.animationProjectId, 64),
    storyWorkspaceId: cleanText(animation?.storyWorkspaceId, 64),
    scenarioVersion: cleanText(animation?.scenarioVersion, 64),
    durationSeconds: Number.isInteger(animation?.durationSeconds) ? Math.max(2, Math.min(180, Number(animation?.durationSeconds))) : undefined
  } satisfies CharacterScenarioHandoff));
}

export function readCharacterScenarioHandoff(): CharacterScenarioHandoff | null {
  try {
    const source = JSON.parse(localStorage.getItem(HANDOFF_KEY) || '{}');
    const scenario = cleanText(source?.scenario, 8000);
    return scenario ? { scenario, title: cleanText(source?.title, 120), createdAt: cleanText(source?.createdAt, 80), animationProjectId: cleanText(source?.animationProjectId, 64), storyWorkspaceId: cleanText(source?.storyWorkspaceId, 64), scenarioVersion: cleanText(source?.scenarioVersion, 64), durationSeconds: Number.isInteger(source?.durationSeconds) ? Math.max(2, Math.min(180, Number(source.durationSeconds))) : undefined } : null;
  } catch {
    return null;
  }
}

export function clearCharacterScenarioHandoff() {
  localStorage.removeItem(HANDOFF_KEY);
}
