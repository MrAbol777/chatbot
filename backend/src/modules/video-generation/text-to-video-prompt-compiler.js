'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

const COMPILER_VERSION = 't2v-direct-v2';
const SYSTEM_PROMPT_VERSION = 'text-to-video-runtime-v2';
const TIER_NAMES = Object.freeze(['CORE', 'CONTINUITY', 'QUALITY']);
const ASSEMBLY_MODES = Object.freeze([
  Object.freeze({ name: 'full', tiers: TIER_NAMES }),
  Object.freeze({ name: 'balanced', tiers: Object.freeze(['CORE', 'CONTINUITY']) }),
  Object.freeze({ name: 'core', tiers: Object.freeze(['CORE']) })
]);

class TextToVideoPromptCompilerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'TextToVideoPromptCompilerError';
    this.code = code;
    this.details = details;
  }
}

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');

function parseTiers(source) {
  const value = String(source || '');
  if (!value.trim()) throw new TextToVideoPromptCompilerError('T2V_SYSTEM_PROMPT_UNAVAILABLE');
  const tiers = {};
  for (const name of TIER_NAMES) {
    const match = value.match(new RegExp(`\\[\\[${name}\\]\\]([\\s\\S]*?)\\[\\[\\/${name}\\]\\]`));
    if (!match?.[1]?.trim()) throw new TextToVideoPromptCompilerError('T2V_SYSTEM_PROMPT_INVALID', { missingTier: name });
    tiers[name] = match[1].trim();
  }
  return Object.freeze(tiers);
}

function settingsBlock(settings = {}) {
  return [
    '[OUTPUT SETTINGS — REQUIRED]',
    `style=${String(settings.styleKey || 'unspecified')}`,
    `duration=${String(settings.duration || 'unspecified')}s`,
    `resolution=${String(settings.resolution || 'unspecified')}`,
    `aspect_ratio=${String(settings.aspectRatio || 'unspecified')}`,
    `audio=${settings.generateAudio === true ? 'enabled' : 'disabled'}`
  ].join('; ');
}

function assemble({ rules, userPrompt, settings }) {
  return [
    '[SYSTEM PRODUCTION RULES — APPLY INTERNALLY]',
    rules,
    settingsBlock(settings),
    `[USER REQUEST — AUTHORITATIVE CREATIVE CONTENT; PRESERVE ALL ${userPrompt.length} CHARACTERS]`,
    userPrompt,
    '[END USER REQUEST]',
    'Generate the video now from the complete USER REQUEST under the SYSTEM PRODUCTION RULES and OUTPUT SETTINGS.'
  ].join('\n\n');
}

function createTextToVideoPromptCompiler({
  systemPromptPath,
  fileStore = fs,
  compilerVersion = COMPILER_VERSION,
  systemPromptVersion = SYSTEM_PROMPT_VERSION
} = {}) {
  let canonical;
  try {
    canonical = fileStore.readFileSync(systemPromptPath, 'utf8');
  } catch (_) {
    throw new TextToVideoPromptCompilerError('T2V_SYSTEM_PROMPT_UNAVAILABLE');
  }
  const tiers = parseTiers(canonical);
  const systemPromptHash = sha256(canonical);

  function compile({ profile, userPrompt, settings, maxCompiledPromptLength = 8000 } = {}) {
    const exactUserPrompt = typeof userPrompt === 'string' ? userPrompt : '';
    const limit = Number(maxCompiledPromptLength);
    if (!exactUserPrompt.trim()) throw new TextToVideoPromptCompilerError('T2V_USER_PROMPT_REQUIRED');
    if (!Number.isSafeInteger(limit) || limit < 256) throw new TextToVideoPromptCompilerError('T2V_PROMPT_LIMIT_INVALID');

    for (const mode of ASSEMBLY_MODES) {
      const rules = mode.tiers.map((name) => tiers[name]).join('\n\n');
      const compiledPrompt = assemble({ rules, userPrompt: exactUserPrompt, settings });
      if (compiledPrompt.length <= limit) {
        const profileKey = String(profile?.profile_key || profile?.profileKey || settings?.styleKey || '').trim() || null;
        return Object.freeze({
          profileKey,
          profileVersion: Number(profile?.version || profile?.currentVersion || 1),
          compilerVersion,
          systemPromptVersion,
          systemPromptHash,
          assemblyMode: mode.name,
          includedTiers: [...mode.tiers],
          userPrompt: exactUserPrompt,
          userPromptHash: sha256(exactUserPrompt),
          compiledPrompt,
          compiledPromptHash: sha256(compiledPrompt),
          systemChars: rules.length,
          userChars: exactUserPrompt.length,
          finalChars: compiledPrompt.length,
          providerPromptLimit: limit
        });
      }
    }

    const corePrompt = assemble({ rules: tiers.CORE, userPrompt: exactUserPrompt, settings });
    throw new TextToVideoPromptCompilerError('T2V_COMPILED_PROMPT_TOO_LONG', {
      userChars: exactUserPrompt.length,
      minimumFinalChars: corePrompt.length,
      providerPromptLimit: limit
    });
  }

  return Object.freeze({
    compile,
    getDiagnostics: () => Object.freeze({
      compilerVersion,
      systemPromptVersion,
      systemPromptHash,
      systemPromptChars: canonical.length,
      tiers: Object.freeze(Object.fromEntries(TIER_NAMES.map((name) => [name, tiers[name].length])))
    })
  });
}

module.exports = {
  COMPILER_VERSION,
  SYSTEM_PROMPT_VERSION,
  TIER_NAMES,
  TextToVideoPromptCompilerError,
  createTextToVideoPromptCompiler,
  parseTiers
};
