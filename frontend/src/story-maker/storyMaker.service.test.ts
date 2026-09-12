import { describe, expect, it } from 'vitest';
import { buildScenarioPromptPayload } from './storyMaker.service';

describe('buildScenarioPromptPayload', () => {
  it('creates an API-ready storyboard brief from a child story draft', () => {
    const payload = buildScenarioPromptPayload({
      idea: 'یک گربه فضایی دنبال سیاره بستنی‌هاست',
      heroName: 'پوفی',
      companionName: 'ربات آبی',
      mood: 'magical',
      place: 'space',
      customPlace: '',
      length: 'medium',
      customSceneCount: '',
      ending: 'happy',
      customEnding: ''
    });

    expect(payload).toMatchObject({
      version: '1.0',
      locale: 'fa-IR',
      format: 'animated_storyboard',
      output: { scenes: 5 }
    });
    expect(payload.output.include).toContain('dialogue');
    expect(payload.draft.heroName).toBe('پوفی');
  });
});
