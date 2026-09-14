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
    personality: clean(character?.personality, 160),
    specialAbility: clean(character?.specialAbility, 160),
    relationship: clean(character?.relationship, 140),
    visualSignature: clean(character?.visualSignature, 140),
    goal: clean(character?.goal, 140),
    voiceStyle: clean(character?.voiceStyle, 100)
  })).filter((character) => character.name);
  const sceneFields = ['title', 'duration', 'presentCharacters', 'emotion', 'goal', 'setting', 'visual', 'camera', 'action', 'dialogue', 'narration', 'reaction', 'sound', 'continuity', 'outcome', 'transition', 'imagePrompt'];
  const scenes = (Array.isArray(source.scenes) ? source.scenes : []).slice(0, expectedScenes + 1).map((scene, index) => {
    const normalized = { number: index + 1 };
    sceneFields.forEach((field) => { normalized[field] = clean(scene?.[field], field === 'imagePrompt' ? 600 : 420); });
    return normalized;
  });
  return {
    title: clean(source.title, 100),
    audience: clean(source.audience, 120),
    duration: clean(source.duration, 80),
    openingHook: clean(source.openingHook, 180),
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
  ['title', 'audience', 'duration', 'openingHook', 'logline', 'message', 'visualStyle', 'world', 'ending'].forEach((field) => {
    if (!scenario[field]) errors.push(`missing_${field}`);
  });
  if (!scenario.characters.length) errors.push('missing_characters');
  scenario.characters.forEach((character, index) => ['description', 'personality', 'specialAbility', 'relationship', 'visualSignature', 'goal', 'voiceStyle'].forEach((field) => {
    if (!character[field]) errors.push(`character_${index + 1}_missing_${field}`);
  }));
  ['setup', 'goal', 'obstacle', 'climax', 'resolution'].forEach((field) => {
    if (!scenario.storyBeats[field]) errors.push(`missing_beat_${field}`);
  });
  if (scenario.scenes.length !== expectedScenes) errors.push(`scene_count_${scenario.scenes.length}_expected_${expectedScenes}`);
  const requiredSceneFields = ['title', 'duration', 'presentCharacters', 'emotion', 'goal', 'setting', 'visual', 'camera', 'action', 'dialogue', 'reaction', 'sound', 'continuity', 'outcome', 'transition', 'imagePrompt'];
  scenario.scenes.forEach((scene, index) => requiredSceneFields.forEach((field) => {
    if (!scene[field]) errors.push(`scene_${index + 1}_missing_${field}`);
  }));
  return { valid: errors.length === 0, errors };
}

function buildScenarioMarkdown(scenario) {
  const lines = [
    `# ${scenario.title}`,
    '',
    '## درباره‌ی این داستان',
    `**مناسب برای:** ${scenario.audience}`,
    `**مدت تقریبی:** ${scenario.duration}`,
    `**اتفاق جذابِ شروع:** ${scenario.openingHook}`,
    `**خلاصه‌ی کوتاه:** ${scenario.logline}`,
    `**حرفِ اصلی داستان:** ${scenario.message}`,
    `**جایی که داستان رخ می‌دهد:** ${scenario.world}`,
    `**ظاهرِ تصویرها:** ${scenario.visualStyle}`,
    '',
    '## شخصیت‌های داستان'
  ];
  scenario.characters.forEach((character) => {
    lines.push(`### ${character.name}`, `**ظاهر و ویژگی‌ها:** ${character.description}`, `**رفتار و اخلاق:** ${character.personality}`, `**تواناییِ ویژه:** ${character.specialAbility}`, `**رابطه با قهرمان:** ${character.relationship}`, `**نشانه‌ی ظاهریِ ثابت:** ${character.visualSignature}`, `**چیزی که می‌خواهد:** ${character.goal}`, `**شیوه‌ی حرف‌زدن:** ${character.voiceStyle}`, '');
  });
  lines.push('## مسیر داستان', `**شروع:** ${scenario.storyBeats.setup}`, `**چیزی که قهرمان می‌خواهد:** ${scenario.storyBeats.goal}`, `**مشکل اصلی:** ${scenario.storyBeats.obstacle}`, `**هیجان‌انگیزترین بخش:** ${scenario.storyBeats.climax}`, `**پایان ماجرا:** ${scenario.storyBeats.resolution}`, '', '## داستان، بخش‌به‌بخش');
  scenario.scenes.forEach((scene) => {
    lines.push(
      `### بخش ${scene.number}: ${scene.title}`,
      `**زمان این بخش:** ${scene.duration}`,
      `**شخصیت‌های حاضر:** ${scene.presentCharacters}`,
      `**حسِ اصلی:** ${scene.emotion}`,
      `**هدف این بخش:** ${scene.goal}`,
      `**جا و حال‌وهوا:** ${scene.setting}`,
      `**چیزی که دیده می‌شود:** ${scene.visual}`,
      `**نگاه دوربین:** ${scene.camera}`,
      `**اتفاقی که می‌افتد:** ${scene.action}`,
      `**حرف شخصیت:** ${scene.dialogue}`,
      ...(scene.narration ? [`**صدای راوی:** ${scene.narration}`] : []),
      `**واکنش شخصیت‌ها:** ${scene.reaction}`,
      `**صدا و موسیقی:** ${scene.sound}`,
      `**ارتباط با بخش قبل:** ${scene.continuity}`,
      `**نتیجه‌ی این بخش:** ${scene.outcome}`,
      `**رفتن به بخش بعد:** ${scene.transition}`,
      `**متنِ ساخت تصویر یا ویدیو:** ${scene.imagePrompt}`,
      ''
    );
  });
  lines.push('## پایان داستان', scenario.ending);
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
    'تمام فیلدهای سناریو باید کامل بمانند: مخاطب، مدت، اتفاق جذاب شروع، شخصیت‌پردازیِ کامل هر شخصیت، و برای هر بخش زمان، شخصیت‌های حاضر، حس، هدف، فضا، تصویر، دوربین، اتفاق، دیالوگ، نریشن، واکنش، صدا، پیوستگی، نتیجه، برش و متنِ ساخت تصویر/ویدیو.',
    'برای هر شخصیت، رفتار و اخلاق، تواناییِ ویژه، رابطه با قهرمان و نشانه‌ی ظاهریِ ثابت را نگه دار یا بهتر کن. دوست‌های قهرمان باید نقشِ واقعی و تواناییِ متفاوت داشته باشند؛ شخصیتِ تزئینی نساز.',
    'پیوستگی نام، ظاهر، هدف و لحن شخصیت‌ها را حفظ کن. هر صحنه باید از نتیجه‌ی صحنه‌ی قبل آغاز شود و outcome آن، علت روشنِ صحنه‌ی بعد باشد. واکنش شخصیت‌ها را قابل‌دیدن و اثرگذار نگه دار.',
    'همه‌ی متن‌ها فارسیِ معیار باشند. در دیالوگ و نریشن، برای تلفظ بی‌ابهام از کسره‌ی اضافه، همزه و حرکت‌های لازمِ فارسی/عربی استفاده کن؛ فقط اعراب‌گذاریِ درست و ضروری مجاز است.',
    'خروجی برای کاربر عادی است؛ در مقدار فیلدها از اصطلاحات فنی و خارجی مانند لاگ‌لاین، تایم‌لاین، بیت، شات، پلان، کات، نریشن و پرامپت استفاده نکن و همان مفهوم را با فارسیِ ساده بنویس.',
    scope,
    `درخواست کاربر: ${clean(request, 500)}`,
    'سناریوی فعلی:',
    JSON.stringify(scenario)
  ].join('\n\n');
}

module.exports = { buildRepairPrompt, buildRevisionPrompt, buildScenarioMarkdown, normalizeScenario, parseJsonObject, validateScenario };
