export type CharacterScenarioHandoff = {
  scenario: string;
  title: string;
  createdAt: string;
};

const HANDOFF_KEY = 'danoa:character-maker:scenario-handoff:v1';

const cleanText = (value: unknown, maxLength: number) => typeof value === 'string'
  ? value.trim().slice(0, maxLength)
  : '';

export function saveCharacterScenarioHandoff(scenario: string, title = '') {
  const cleanScenario = cleanText(scenario, 8000);
  if (!cleanScenario) return;
  localStorage.setItem(HANDOFF_KEY, JSON.stringify({
    scenario: cleanScenario,
    title: cleanText(title, 120),
    createdAt: new Date().toISOString()
  } satisfies CharacterScenarioHandoff));
}

export function readCharacterScenarioHandoff(): CharacterScenarioHandoff | null {
  try {
    const source = JSON.parse(localStorage.getItem(HANDOFF_KEY) || '{}');
    const scenario = cleanText(source?.scenario, 8000);
    return scenario ? { scenario, title: cleanText(source?.title, 120), createdAt: cleanText(source?.createdAt, 80) } : null;
  } catch {
    return null;
  }
}

export function clearCharacterScenarioHandoff() {
  localStorage.removeItem(HANDOFF_KEY);
}
