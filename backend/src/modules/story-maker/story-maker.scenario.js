'use strict';

const clean = (value, max = 500) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

function parseJsonObject(reply) {
  const text = String(reply || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function normalizeScenario(value, expectedScenes) {
  const source = value && typeof value === 'object' ? value : {};
  const characters = (Array.isArray(source.characters) ? source.characters : []).slice(0, 5).map((character) => ({
    name: clean(character?.name, 60),
    description: clean(character?.description, 180),
    goal: clean(character?.goal, 140),
    voiceStyle: clean(character?.voiceStyle, 100)
  })).filter((character) => character.name);
  const sceneFields = ['title', 'goal', 'setting', 'visual', 'camera', 'action', 'dialogue', 'narration', 'sound', 'continuity', 'transition', 'imagePrompt'];
  const scenes = (Array.isArray(source.scenes) ? source.scenes : []).slice(0, expectedScenes + 1).map((scene, index) => {
    const normalized = { number: index + 1 };
    sceneFields.forEach((field) => { normalized[field] = clean(scene?.[field], field === 'imagePrompt' ? 600 : 420); });
    return normalized;
  });
  return {
    title: clean(source.title, 100),
    logline: clean(source.logline, 260),
    message: clean(source.message, 180),
    visualStyle: clean(source.visualStyle, 160),
    world: clean(source.world, 240),
    characters,
    storyBeats: {
      setup: clean(source.storyBeats?.setup, 240),
      goal: clean(source.storyBeats?.goal, 180),
      obstacle: clean(source.storyBeats?.obstacle, 200),
      climax: clean(source.storyBeats?.climax, 220),
      resolution: clean(source.storyBeats?.resolution, 220)
    },
    scenes,
    ending: clean(source.ending, 320)
  };
}

function validateScenario(scenario, expectedScenes) {
  const errors = [];
  ['title', 'logline', 'message', 'visualStyle', 'world', 'ending'].forEach((field) => {
    if (!scenario[field]) errors.push(`missing_${field}`);
  });
  if (!scenario.characters.length) errors.push('missing_characters');
  ['setup', 'goal', 'obstacle', 'climax', 'resolution'].forEach((field) => {
    if (!scenario.storyBeats[field]) errors.push(`missing_beat_${field}`);
  });
  if (scenario.scenes.length !== expectedScenes) errors.push(`scene_count_${scenario.scenes.length}_expected_${expectedScenes}`);
  const requiredSceneFields = ['title', 'goal', 'setting', 'visual', 'camera', 'action', 'dialogue', 'sound', 'continuity', 'transition', 'imagePrompt'];
  scenario.scenes.forEach((scene, index) => requiredSceneFields.forEach((field) => {
    if (!scene[field]) errors.push(`scene_${index + 1}_missing_${field}`);
  }));
  return { valid: errors.length === 0, errors };
}

function buildScenarioMarkdown(scenario) {
  const lines = [
    `# ${scenario.title}`,
    '',
    '## شناسنامه‌ی داستان',
    `**لاگ‌لاین:** ${scenario.logline}`,
    `**پیام داستان:** ${scenario.message}`,
    `**دنیای داستان:** ${scenario.world}`,
    `**سبک تصویری:** ${scenario.visualStyle}`,
    '',
    '## شخصیت‌ها'
  ];
  scenario.characters.forEach((character) => {
    lines.push(`### ${character.name}`, `**ویژگی و ظاهر:** ${character.description}`, `**هدف:** ${character.goal}`, `**لحن حرف‌زدن:** ${character.voiceStyle}`, '');
  });
  lines.push('## نقشه‌ی داستان', `**شروع:** ${scenario.storyBeats.setup}`, `**هدف:** ${scenario.storyBeats.goal}`, `**مانع:** ${scenario.storyBeats.obstacle}`, `**نقطه‌ی اوج:** ${scenario.storyBeats.climax}`, `**حل ماجرا:** ${scenario.storyBeats.resolution}`, '', '## سناریوی صحنه‌به‌صحنه');
  scenario.scenes.forEach((scene) => {
    lines.push(
      `### صحنه ${scene.number}: ${scene.title}`,
      `**هدف صحنه:** ${scene.goal}`,
      `**فضا:** ${scene.setting}`,
      `**تصویر:** ${scene.visual}`,
      `**دوربین:** ${scene.camera}`,
      `**اتفاق:** ${scene.action}`,
      `**دیالوگ:** ${scene.dialogue}`,
      ...(scene.narration ? [`**نریشن:** ${scene.narration}`] : []),
      `**صدا و موسیقی:** ${scene.sound}`,
      `**پیوستگی:** ${scene.continuity}`,
      `**برش بعدی:** ${scene.transition}`,
      `**پرامپت تصویر/ویدیو:** ${scene.imagePrompt}`,
      ''
    );
  });
  lines.push('## پایان', scenario.ending);
  return lines.join('\n');
}

function buildRepairPrompt(originalPrompt, invalidReply, errors) {
  return [
    'خروجی سناریو از کنترل کیفیت عبور نکرده است. فقط JSON معتبر با همان قرارداد قبلی برگردان؛ هیچ توضیح اضافه نده.',
    `نقص‌ها: ${errors.join(', ')}`,
    'دستور اصلی:', originalPrompt,
    'خروجی ناقص برای اصلاح:', String(invalidReply || '').slice(0, 18_000)
  ].join('\n\n');
}

function buildRevisionPrompt(scenario, { request, targetScene }) {
  const scope = targetScene ? `فقط صحنه ${targetScene} را تغییر بده و باقی صحنه‌ها، شخصیت‌ها و مسیر داستان را تا حد ممکن ثابت نگه دار.` : 'تغییر در کل داستان مجاز است، اما جزئیات مفید و انتخاب‌های قبلی کودک را حفظ کن.';
  return [
    'تو ویراستار حرفه‌ای سناریوی کودک هستی. فقط JSON معتبر و کامل با همان ساختار سناریوی ورودی برگردان؛ Markdown یا توضیح اضافه ننویس.',
    'تمام فیلدهای تولیدی هر صحنه باید کامل بمانند: هدف، فضا، تصویر، دوربین، اتفاق، دیالوگ، صدا، پیوستگی، برش و پرامپت تصویر/ویدیو.',
    'پیوستگی نام، ظاهر، هدف و لحن شخصیت‌ها را حفظ کن. محتوای کودک‌دوست و امن باقی بماند.',
    scope,
    `درخواست کاربر: ${clean(request, 500)}`,
    'سناریوی فعلی:',
    JSON.stringify(scenario)
  ].join('\n\n');
}

module.exports = { buildRepairPrompt, buildRevisionPrompt, buildScenarioMarkdown, normalizeScenario, parseJsonObject, validateScenario };
