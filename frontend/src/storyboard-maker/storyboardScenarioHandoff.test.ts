import { beforeEach, describe, expect, it } from 'vitest';
import { readStoryboardScenarioHandoff, saveStoryboardScenarioHandoff } from './storyboardScenarioHandoff';

describe('storyboard scenario handoff', () => {
  beforeEach(() => localStorage.clear());

  it('carries the story forward without asking the user to write it again', () => {
    saveStoryboardScenarioHandoff('رها برای پیدا کردن ستاره‌ی گمشده به جنگل می‌رود.', 'ستاره‌ی گمشده');
    expect(readStoryboardScenarioHandoff()).toEqual({
      scenario: 'رها برای پیدا کردن ستاره‌ی گمشده به جنگل می‌رود.',
      title: 'ستاره‌ی گمشده'
    });
  });

  it('does not save an empty handoff', () => {
    saveStoryboardScenarioHandoff('   ');
    expect(readStoryboardScenarioHandoff()).toBeNull();
  });
});
