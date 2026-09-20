'use strict';

const STAGES = ['idea', 'questions', 'summary', 'scenario', 'characters', 'storyboard', 'video', 'completed', 'error'];
// The legacy values stay accepted so projects created before the review flow
// remain readable. New animation projects use the explicit review states.
const STATUSES = ['draft', 'active', 'pending', 'processing', 'completed', 'failed', 'partial_failed', 'cancelled', 'scenario_approved', 'characters_generating', 'characters_review', 'characters_approved', 'storyboard_generating', 'storyboard_review', 'storyboard_approved', 'video_queued', 'video_processing'];
const STYLES = ['animated', 'three-dimensional', 'realistic', 'cinematic', 'cartoon', 'stop-motion'];
const AUDIENCES = ['preschool', 'children', 'preteen', 'teen', 'family'];
const ASPECT_RATIOS = ['9:16', '16:9', '1:1'];
const MOODS = ['happy', 'emotional', 'adventure', 'educational', 'funny', 'mystery'];
const AUDIO_OPTIONS = ['narrator', 'dialogue', 'music', 'subtitles', 'silent'];

function cleanText(value, maxLength) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function cleanIdList(value, maxItems = 3) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 80))
    .filter((item, index, items) => /^[a-zA-Z0-9-]{1,80}$/.test(item) && items.indexOf(item) === index)
    .slice(0, maxItems);
}

function cleanChoice(value, choices, fallback = '') {
  const candidate = cleanText(value, 64);
  return choices.includes(candidate) ? candidate : fallback;
}

function normalizeDuration(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 2 && seconds <= 180 ? seconds : 10;
}

function normalizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const audio = (Array.isArray(source.audio) ? source.audio : [])
    .map((item) => cleanChoice(item, AUDIO_OPTIONS))
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 4);
  return {
    durationSeconds: normalizeDuration(source.durationSeconds),
    style: cleanChoice(source.style, STYLES),
    location: cleanText(source.location, 160),
    audience: cleanChoice(source.audience, AUDIENCES),
    aspectRatio: cleanChoice(source.aspectRatio, ASPECT_RATIOS, '9:16'),
    mood: cleanChoice(source.mood, MOODS),
    audio: audio.includes('silent') ? ['silent'] : audio,
    referenceNote: cleanText(source.referenceNote, 500)
  };
}

function normalizeAnimationProject(value) {
  const source = value && typeof value === 'object' ? value : {};
  const userInput = source.userInput && typeof source.userInput === 'object' ? source.userInput : {};
  const idea = cleanText(userInput.idea || source.idea, 2000);
  if (!idea) {
    const error = new Error('ANIMATION_IDEA_REQUIRED');
    error.status = 400;
    throw error;
  }
  const stage = cleanChoice(source.stage, STAGES, 'idea');
  const status = cleanChoice(source.status, STATUSES, 'draft');
  const rawApprovals = source.approvals && typeof source.approvals === 'object' ? source.approvals : {};
  const revisions = (Array.isArray(source.revisions) ? source.revisions : []).slice(0, 40).map((revision) => ({
    id: cleanText(revision?.id, 64),
    stage: cleanChoice(revision?.stage, STAGES),
    request: cleanText(revision?.request, 1000),
    createdAt: cleanText(revision?.createdAt, 40)
  })).filter((revision) => revision.stage && revision.request);

  return {
    schemaVersion: 1,
    title: cleanText(source.title, 191) || idea.slice(0, 70) || 'فیلم تازه‌ی من',
    stage,
    status,
    currentStep: Math.max(0, Math.min(7, Number.isInteger(source.currentStep) ? source.currentStep : 0)),
    userInput: { idea, referenceImageIds: cleanIdList(userInput.referenceImageIds) },
    preferences: normalizePreferences(source.preferences),
    approvals: {
      scenario: Boolean(rawApprovals.scenario),
      characters: Boolean(rawApprovals.characters),
      storyboard: Boolean(rawApprovals.storyboard)
    },
    revisions,
    sourceLinks: {
      storyWorkspaceId: cleanText(source.sourceLinks?.storyWorkspaceId, 64),
      characterWorkspaceId: cleanText(source.sourceLinks?.characterWorkspaceId, 64),
      storyboardWorkspaceId: cleanText(source.sourceLinks?.storyboardWorkspaceId, 64),
      videoGenerationId: cleanText(source.sourceLinks?.videoGenerationId, 64)
    },
    // These are compact immutable references, not a second copy of Scenario.
    // Keeping them in the project JSON lets review/retry survive navigation.
    review: {
      scenarioVersion: cleanText(source.review?.scenarioVersion, 64),
      characterVersion: cleanText(source.review?.characterVersion, 64),
      storyboardVersion: cleanText(source.review?.storyboardVersion, 64),
      storyboardDurationSeconds: Math.max(0, Math.min(180, Number(source.review?.storyboardDurationSeconds) || 0)),
      sceneIds: cleanIdList(source.review?.sceneIds, 24),
      characterIds: cleanIdList(source.review?.characterIds, 24),
      locationIds: cleanIdList(source.review?.locationIds, 24),
      propIds: cleanIdList(source.review?.propIds, 24),
      videoPayload: source.review?.videoPayload && typeof source.review.videoPayload === 'object' ? source.review.videoPayload : null
    }
  };
}

module.exports = {
  STAGES,
  STYLES,
  AUDIENCES,
  ASPECT_RATIOS,
  MOODS,
  AUDIO_OPTIONS,
  normalizeAnimationProject,
  normalizePreferences
};
