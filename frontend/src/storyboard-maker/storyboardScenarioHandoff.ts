export type StoryboardScenarioHandoff = {
  scenario: string;
  title: string;
};

const HANDOFF_KEY = 'danoa:storyboard-maker:scenario-handoff:v1';

export function saveStoryboardScenarioHandoff(scenario: string, title = '') {
  const cleanScenario = scenario.trim().slice(0, 12000);
  if (!cleanScenario) return;
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ scenario: cleanScenario, title: title.trim().slice(0, 120) } satisfies StoryboardScenarioHandoff));
  } catch {
    // A blocked storage area must not interrupt the flow.
  }
}

export function readStoryboardScenarioHandoff(): StoryboardScenarioHandoff | null {
  try {
    const value = JSON.parse(localStorage.getItem(HANDOFF_KEY) || '{}');
    const scenario = typeof value.scenario === 'string' ? value.scenario.trim().slice(0, 12000) : '';
    return scenario ? { scenario, title: typeof value.title === 'string' ? value.title.trim().slice(0, 120) : '' } : null;
  } catch {
    return null;
  }
}
