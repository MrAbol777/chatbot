'use strict';

const { createHash } = require('crypto');
const { VIDEO_PROMPT_PRESETS } = require('./video-prompt-presets');

const COMPILER_VERSION = '3';
const DEFAULT_MAX_USER_PROMPT_LENGTH = 2000;
const DEFAULT_MAX_COMPILED_PROMPT_LENGTH = 2000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

class VideoPromptCompilerError extends Error {
  constructor(code, message) { super(message); this.name = 'VideoPromptCompilerError'; this.code = code; this.status = 400; }
}

const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');
const parseManifest = (value) => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_) { throw new VideoPromptCompilerError('VIDEO_PROMPT_PROFILE_MANIFEST_INVALID', 'قواعد پروفایل معتبر نیست.'); }
};
const normalizeText = (value) => String(value ?? '').normalize('NFKC').replace(CONTROL_CHARACTERS, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const uniqueLines = (values) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map(normalizeText).filter((value) => {
    const key = value.toLocaleLowerCase('en-US');
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  });
};
const section = (title, lines) => `[[${title}]]\n${lines.join('\n')}`;
const renderSections = (sections) => sections.map(([title, lines]) => section(title, lines)).join('\n\n');
const truncate = (value, maximum) => {
  const normalized = normalizeText(value);
  if (normalized.length <= maximum) return normalized;
  if (maximum <= 1) return normalized.slice(0, maximum);
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`;
};

function compileWithinBudget({ profileKey, baseSystemPrompt, styleProfile, nonNegotiableRules, userPrompt, decisions, settingLine, outputQuality, maximum }) {
  const baseLead = baseSystemPrompt.split(/\n|(?<=[.!؟])\s+/u).map(normalizeText).find((value) => value && !/^#{1,6}\s|^-{3,}$/.test(value)) || `Follow the ${profileKey} animation profile.`;
  const sections = [
    ['SYSTEM PROMPT', [truncate(baseLead, 240)]],
    ['STYLE PROFILE', []],
    ['NON-NEGOTIABLE RULES', []],
    ['USER REQUEST', [userPrompt]],
    ['DIRECTING DECISIONS', [`- ${settingLine}`]],
    ['OUTPUT QUALITY', []]
  ];
  const addIfFits = (index, value) => {
    if (!value) return false;
    sections[index][1].push(value);
    if (renderSections(sections).length <= maximum) return true;
    sections[index][1].pop();
    return false;
  };

  for (const rule of nonNegotiableRules) addIfFits(2, `- ${rule}`);
  for (const rule of outputQuality) addIfFits(5, `- ${rule}`);
  for (const value of styleProfile) addIfFits(1, value);
  for (const rule of decisions) addIfFits(4, `- ${rule}`);

  const compiled = renderSections(sections);
  if (compiled.length > maximum) {
    throw new VideoPromptCompilerError('VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', 'متن درخواست پس از اعمال قواعد سبک از سقف مدل بیشتر است.');
  }
  return compiled;
}

class VideoPromptCompiler {
  constructor({ maxUserPromptLength = DEFAULT_MAX_USER_PROMPT_LENGTH } = {}) {
    this.maxUserPromptLength = Number(maxUserPromptLength);
    if (!Number.isSafeInteger(this.maxUserPromptLength) || this.maxUserPromptLength < 3) throw new Error('maxUserPromptLength is invalid.');
  }

  compile({ profile, userPrompt, settings = {}, maxCompiledPromptLength = DEFAULT_MAX_COMPILED_PROMPT_LENGTH }) {
    if (!profile || !profile.profile_key || !profile.version || !profile.base_system_prompt || !profile.execution_template) {
      throw new VideoPromptCompilerError('VIDEO_PROMPT_PROFILE_INVALID', 'نسخه پروفایل ویدیو کامل نیست.');
    }
    const normalizedUserPrompt = normalizeText(userPrompt);
    const compiledLimit = Number(maxCompiledPromptLength);
    if (!Number.isSafeInteger(compiledLimit) || compiledLimit < 256) throw new Error('maxCompiledPromptLength is invalid.');
    if (normalizedUserPrompt.length < 3) throw new VideoPromptCompilerError('VIDEO_GENERATION_INVALID_PROMPT', 'توضیح حرکت باید حداقل ۳ کاراکتر باشد.');
    if (normalizedUserPrompt.length > this.maxUserPromptLength) throw new VideoPromptCompilerError('VIDEO_GENERATION_PROMPT_TOO_LONG', `حداکثر ${this.maxUserPromptLength} کاراکتر مجاز است.`);

    const manifest = parseManifest(profile.rules_manifest_json);
    const canonicalManifest = VIDEO_PROMPT_PRESETS.find((item) => item.profileKey === String(profile.profile_key))?.rulesManifest || null;
    const baseSystemPrompt = normalizeText(profile.base_system_prompt);
    const executionTemplate = normalizeText(profile.execution_template);
    const nonNegotiableRules = uniqueLines([...(canonicalManifest?.nonNegotiableRules || []), ...(manifest.nonNegotiableRules || [])]);
    const outputQuality = uniqueLines([...(canonicalManifest?.outputQuality || []), ...(manifest.outputQuality || [])]);
    if (!nonNegotiableRules.length || !outputQuality.length) throw new VideoPromptCompilerError('VIDEO_PROMPT_PROFILE_MANIFEST_INVALID', 'قواعد غیرقابل حذف پروفایل کامل نیست.');
    const decisions = uniqueLines([...(canonicalManifest?.directingDecisions || []), ...(manifest.directingDecisions || [])]);
    const styleProfile = uniqueLines([manifest.styleProfile || canonicalManifest?.styleProfile, executionTemplate]);
    const settingLine = `Duration: ${normalizeText(settings.duration || 'unspecified')}; resolution: ${normalizeText(settings.resolution || 'unspecified')}; aspect ratio: ${normalizeText(settings.aspectRatio || 'unspecified')}; audio: ${settings.generateAudio === true ? 'enabled' : 'disabled'}.`;
    const sections = [
      section('SYSTEM PROMPT', [baseSystemPrompt]),
      section('STYLE PROFILE', styleProfile),
      section('NON-NEGOTIABLE RULES', nonNegotiableRules.map((rule) => `- ${rule}`)),
      section('USER REQUEST', [normalizedUserPrompt]),
      section('DIRECTING DECISIONS', [...decisions.map((rule) => `- ${rule}`), `- ${settingLine}`]),
      section('OUTPUT QUALITY', outputQuality.map((rule) => `- ${rule}`))
    ];
    const completePrompt = sections.join('\n\n');
    const compiledPrompt = completePrompt.length <= compiledLimit ? completePrompt : compileWithinBudget({
      profileKey: String(profile.profile_key),
      baseSystemPrompt,
      styleProfile,
      nonNegotiableRules,
      userPrompt: normalizedUserPrompt,
      decisions,
      settingLine,
      outputQuality,
      maximum: compiledLimit
    });

    return {
      profileKey: String(profile.profile_key),
      profileVersion: Number(profile.version),
      compilerVersion: COMPILER_VERSION,
      userPrompt: normalizedUserPrompt,
      compiledPrompt,
      compiledPromptHash: sha256(compiledPrompt)
    };
  }
}

const profileChecksum = ({ baseSystemPrompt, executionTemplate, rulesManifest }) => sha256([
  normalizeText(baseSystemPrompt), normalizeText(executionTemplate), JSON.stringify(rulesManifest)
].join('\n---\n'));

module.exports = { VideoPromptCompiler, VideoPromptCompilerError, COMPILER_VERSION, DEFAULT_MAX_USER_PROMPT_LENGTH, DEFAULT_MAX_COMPILED_PROMPT_LENGTH, normalizeText, profileChecksum, sha256 };
