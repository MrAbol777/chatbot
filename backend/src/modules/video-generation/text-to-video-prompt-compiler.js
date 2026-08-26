'use strict';

const { createHash } = require('crypto');
const { fail } = require('./video-generation.errors');

const COMPILER_VERSION = 't2v-1';

const STYLE_DIRECTIONS = Object.freeze({
  cinematic: [
    'Create an original cinematic video from the user description.',
    'Use believable motion, coherent lighting, stable subjects, and one clear camera movement.',
    'Keep the scene age-appropriate and avoid adding text, logos, watermarks, or unrelated elements.'
  ].join(' '),
  animation: [
    'Create an original polished animated video from the user description.',
    'Use expressive but coherent motion, consistent character design, and one clear camera movement.',
    'Keep the scene age-appropriate and avoid adding text, logos, watermarks, or unrelated elements.'
  ].join(' ')
});

function compileTextToVideoPrompt({ profile, userPrompt, settings, maxCompiledPromptLength = 2000 }) {
  const profileKey = String(profile?.profile_key || profile?.profileKey || '').trim();
  const direction = STYLE_DIRECTIONS[profileKey];
  if (!direction) throw fail('VIDEO_PROMPT_PROFILE_UNAVAILABLE', 'سبک ساخت ویدیو فعال یا عمومی نیست.', 409);
  const cleanUserPrompt = String(userPrompt || '').trim();
  const context = `Output: ${settings.duration}s, ${settings.resolution}, ${settings.aspectRatio}, no audio.`;
  const compiledPrompt = `${direction}\n\n${context}\n\nUser scene: ${cleanUserPrompt}`;
  if (compiledPrompt.length > maxCompiledPromptLength) {
    throw fail('VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', 'توضیح ویدیو پس از اعمال سبک از حد مجاز بیشتر است.', 409);
  }
  return {
    profileKey,
    profileVersion: Number(profile.version || profile.currentVersion || 1),
    compilerVersion: COMPILER_VERSION,
    userPrompt: cleanUserPrompt,
    compiledPrompt,
    compiledPromptHash: createHash('sha256').update(compiledPrompt).digest('hex')
  };
}

module.exports = { COMPILER_VERSION, STYLE_DIRECTIONS, compileTextToVideoPrompt };
