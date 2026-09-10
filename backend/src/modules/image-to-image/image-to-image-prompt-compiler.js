'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

const COMPILER_VERSION = 'i2i-direct-v1';
const SYSTEM_PROMPT_VERSION = 'image-to-image-runtime-v1';
const TIER_NAMES = Object.freeze(['CORE', 'FIDELITY', 'QUALITY']);
const ASSEMBLY_MODES = Object.freeze([
  Object.freeze({ name: 'full', tiers: TIER_NAMES }),
  Object.freeze({ name: 'balanced', tiers: Object.freeze(['CORE', 'FIDELITY']) }),
  Object.freeze({ name: 'core', tiers: Object.freeze(['CORE']) })
]);

class ImageToImagePromptCompilerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ImageToImagePromptCompilerError';
    this.code = code;
    this.details = details;
  }
}

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');

function parseTiers(source) {
  const value = String(source || '');
  if (!value.trim()) throw new ImageToImagePromptCompilerError('I2I_SYSTEM_PROMPT_UNAVAILABLE');
  const tiers = {};
  for (const name of TIER_NAMES) {
    const match = value.match(new RegExp(`\\[\\[${name}\\]\\]([\\s\\S]*?)\\[\\[\\/${name}\\]\\]`));
    if (!match?.[1]?.trim()) throw new ImageToImagePromptCompilerError('I2I_SYSTEM_PROMPT_INVALID', { missingTier: name });
    tiers[name] = match[1].trim();
  }
  return Object.freeze(tiers);
}

function settingsBlock(settings = {}) {
  const imageCount = Number(settings.imageCount);
  return [
    '[OUTPUT SETTINGS — REQUIRED]',
    `aspect_ratio=${String(settings.aspectRatio || 'unspecified')}`,
    `input_reference_images=${Number.isSafeInteger(imageCount) && imageCount > 0 ? imageCount : 'unspecified'}`,
    `model=${String(settings.model || 'unspecified')}`
  ].join('; ');
}

function assemble({ rules, userPrompt, settings }) {
  return [
    '[SYSTEM IMAGE EDITING RULES — APPLY INTERNALLY]',
    rules,
    settingsBlock(settings),
    `[USER REQUEST — AUTHORITATIVE CREATIVE CONTENT; PRESERVE ALL ${userPrompt.length} CHARACTERS]`,
    userPrompt,
    '[END USER REQUEST]',
    'Use the supplied reference images and generate the requested image now under the SYSTEM IMAGE EDITING RULES and OUTPUT SETTINGS.'
  ].join('\n\n');
}

function createImageToImagePromptCompiler({
  systemPromptPath,
  fileStore = fs,
  compilerVersion = COMPILER_VERSION,
  systemPromptVersion = SYSTEM_PROMPT_VERSION
} = {}) {
  let canonical;
  try {
    canonical = fileStore.readFileSync(systemPromptPath, 'utf8');
  } catch (_) {
    throw new ImageToImagePromptCompilerError('I2I_SYSTEM_PROMPT_UNAVAILABLE');
  }
  const tiers = parseTiers(canonical);
  const systemPromptHash = sha256(canonical);

  function compile({ userPrompt, settings, maxCompiledPromptLength = 8000 } = {}) {
    const exactUserPrompt = typeof userPrompt === 'string' ? userPrompt : '';
    const limit = Number(maxCompiledPromptLength);
    if (!exactUserPrompt.trim()) throw new ImageToImagePromptCompilerError('I2I_USER_PROMPT_REQUIRED');
    if (!Number.isSafeInteger(limit) || limit < 256) throw new ImageToImagePromptCompilerError('I2I_PROMPT_LIMIT_INVALID');

    for (const mode of ASSEMBLY_MODES) {
      const rules = mode.tiers.map((name) => tiers[name]).join('\n\n');
      const compiledPrompt = assemble({ rules, userPrompt: exactUserPrompt, settings });
      if (compiledPrompt.length <= limit) {
        return Object.freeze({
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
    throw new ImageToImagePromptCompilerError('I2I_COMPILED_PROMPT_TOO_LONG', {
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
  ImageToImagePromptCompilerError,
  createImageToImagePromptCompiler,
  parseTiers
};
