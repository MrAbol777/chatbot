'use strict';

const clean = (value, max = 500) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const id = (value, prefix, fallback) => {
  const candidate = clean(value, 12).toUpperCase();
  return new RegExp(`^${prefix}\\d{2}$`).test(candidate) ? candidate : `${prefix}${String(fallback).padStart(2, '0')}`;
};
const list = (value, max, mapper) => (Array.isArray(value) ? value : []).slice(0, max).map(mapper);

function parseJsonObject(reply) {
  const text = String(reply || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function normalizeScenario(value, expectedScenes) {
  const source = value && typeof value === 'object' ? value : {};
  const schemaVersion = Number(source.schemaVersion) === 2 ? 2 : 1;
  const visualBible = {
    style: clean(source.visualBible?.style, 180),
    animationStyle: clean(source.visualBible?.animationStyle, 160),
    characterDesignLanguage: clean(source.visualBible?.characterDesignLanguage, 240),
    environmentDesignLanguage: clean(source.visualBible?.environmentDesignLanguage, 240),
    colorLightingMood: clean(source.visualBible?.colorLightingMood, 200),
    consistencyRules: clean(source.visualBible?.consistencyRules, 320)
  };
  const characters = list(source.characters, 5, (character, index) => ({
    id: id(character?.id, 'C', index + 1),
    name: clean(character?.name, 60),
    role: clean(character?.role, 100),
    description: clean(character?.description, 180),
    personality: clean(character?.personality, 160),
    apparentAge: clean(character?.apparentAge, 80),
    speciesType: clean(character?.speciesType, 100),
    bodyProportions: clean(character?.bodyProportions, 180),
    face: clean(character?.face, 180),
    eyes: clean(character?.eyes, 140),
    hairOrFur: clean(character?.hairOrFur, 140),
    clothing: clean(character?.clothing, 180),
    accessories: clean(character?.accessories, 140),
    colors: clean(character?.colors, 140),
    uniqueVisualTraits: clean(character?.uniqueVisualTraits, 180),
    expressions: clean(character?.expressions, 160),
    bodyLanguage: clean(character?.bodyLanguage, 160),
    goalsFears: clean(character?.goalsFears, 200),
    consistencyRules: clean(character?.consistencyRules, 240),
    specialAbility: clean(character?.specialAbility, 160),
    relationship: clean(character?.relationship, 140),
    visualSignature: clean(character?.visualSignature, 140),
    goal: clean(character?.goal, 140),
    voiceStyle: clean(character?.voiceStyle, 100)
  })).filter((character) => character.name);
  const locations = list(source.locations, 8, (location, index) => ({
    id: id(location?.id, 'L', index + 1), name: clean(location?.name, 100), description: clean(location?.description, 240),
    environmentDetails: clean(location?.environmentDetails, 240), timeWeather: clean(location?.timeWeather, 140),
    lighting: clean(location?.lighting, 160), continuityRules: clean(location?.continuityRules, 240)
  }));
  const props = list(source.props, 12, (prop, index) => ({
    id: id(prop?.id, 'P', index + 1), name: clean(prop?.name, 100), description: clean(prop?.description, 180),
    ownerOrLocation: clean(prop?.ownerOrLocation, 120), initialState: clean(prop?.initialState, 160), consistencyRules: clean(prop?.consistencyRules, 220)
  }));
  const sceneFields = ['title', 'duration', 'presentCharacters', 'emotion', 'goal', 'setting', 'visual', 'camera', 'visualIntent', 'action', 'dialogue', 'narration', 'reaction', 'sound', 'continuity', 'startState', 'endState', 'propStates', 'outcome', 'transition', 'imagePrompt'];
  const scenes = list(source.scenes, expectedScenes + 1, (scene, index) => {
    const normalized = { id: id(scene?.id, 'SC', index + 1), number: index + 1, locationId: clean(scene?.locationId, 12).toUpperCase(), characterIds: list(scene?.characterIds, 8, (characterId) => clean(characterId, 12).toUpperCase()).filter(Boolean) };
    sceneFields.forEach((field) => { normalized[field] = clean(scene?.[field], field === 'imagePrompt' ? 600 : 420); });
    return normalized;
  });
  return {
    schemaVersion,
    title: clean(source.title, 100),
    audience: clean(source.audience, 120),
    duration: clean(source.duration, 80),
    openingHook: clean(source.openingHook, 180),
    logline: clean(source.logline, 260),
    message: clean(source.message, 180),
    visualStyle: clean(source.visualStyle, 160),
    visualBible,
    world: clean(source.world, 240),
    characters,
    locations,
    props,
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
  if (scenario.schemaVersion === 2) {
    ['style', 'animationStyle', 'characterDesignLanguage', 'environmentDesignLanguage', 'colorLightingMood', 'consistencyRules'].forEach((field) => {
      if (!scenario.visualBible[field]) errors.push(`missing_visualBible_${field}`);
    });
    if (!scenario.locations.length) errors.push('missing_locations');
    scenario.locations.forEach((location, index) => ['name', 'description', 'environmentDetails', 'timeWeather', 'lighting', 'continuityRules'].forEach((field) => {
      if (!location[field]) errors.push(`location_${index + 1}_missing_${field}`);
    }));
    scenario.props.forEach((prop, index) => ['name', 'description', 'ownerOrLocation', 'initialState', 'consistencyRules'].forEach((field) => {
      if (!prop[field]) errors.push(`prop_${index + 1}_missing_${field}`);
    }));
    scenario.characters.forEach((character, index) => ['role', 'apparentAge', 'speciesType', 'bodyProportions', 'face', 'eyes', 'hairOrFur', 'clothing', 'accessories', 'colors', 'uniqueVisualTraits', 'expressions', 'bodyLanguage', 'goalsFears', 'consistencyRules'].forEach((field) => {
      if (!character[field]) errors.push(`character_${index + 1}_missing_${field}`);
    }));
    if (new Set(scenario.characters.map((character) => character.id)).size !== scenario.characters.length) errors.push('duplicate_character_ids');
    if (new Set(scenario.locations.map((location) => location.id)).size !== scenario.locations.length) errors.push('duplicate_location_ids');
    if (new Set(scenario.props.map((prop) => prop.id)).size !== scenario.props.length) errors.push('duplicate_prop_ids');
  }
  ['setup', 'goal', 'obstacle', 'climax', 'resolution'].forEach((field) => {
    if (!scenario.storyBeats[field]) errors.push(`missing_beat_${field}`);
  });
  if (scenario.scenes.length !== expectedScenes) errors.push(`scene_count_${scenario.scenes.length}_expected_${expectedScenes}`);
  const requiredSceneFields = ['title', 'duration', 'presentCharacters', 'emotion', 'goal', 'setting', 'visual', 'camera', 'action', 'reaction', 'sound', 'continuity', 'outcome', 'transition', 'imagePrompt'];
  scenario.scenes.forEach((scene, index) => requiredSceneFields.forEach((field) => {
    if (!scene[field]) errors.push(`scene_${index + 1}_missing_${field}`);
  }));
  if (scenario.schemaVersion === 2) {
    const characterIds = new Set(scenario.characters.map((character) => character.id));
    const locationIds = new Set(scenario.locations.map((location) => location.id));
    const propIds = new Set(scenario.props.map((prop) => prop.id));
    if (new Set(scenario.scenes.map((scene) => scene.id)).size !== scenario.scenes.length) errors.push('duplicate_scene_ids');
    scenario.scenes.forEach((scene, index) => {
      if (!locationIds.has(scene.locationId)) errors.push(`scene_${index + 1}_invalid_locationId`);
      if (!scene.characterIds.length) errors.push(`scene_${index + 1}_missing_characterIds`);
      scene.characterIds.forEach((characterId) => { if (!characterIds.has(characterId)) errors.push(`scene_${index + 1}_invalid_characterId_${characterId}`); });
      ['visualIntent', 'startState', 'endState'].forEach((field) => { if (!scene[field]) errors.push(`scene_${index + 1}_missing_${field}`); });
      scene.propStates.split(/[،,]/).map((item) => item.trim().split(/[:：]/)[0]).filter(Boolean).forEach((propId) => { if (!propIds.has(propId)) errors.push(`scene_${index + 1}_invalid_propState_${propId}`); });
    });
  }
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
    ...(scenario.schemaVersion === 2 ? ['', '## راهنمای یکپارچه‌ی ساخت', `**سبکِ واحد:** ${scenario.visualBible.style}`, `**شیوه‌ی جان‌بخشی:** ${scenario.visualBible.animationStyle}`, `**زبان طراحی شخصیت‌ها:** ${scenario.visualBible.characterDesignLanguage}`, `**زبان طراحی محیط‌ها:** ${scenario.visualBible.environmentDesignLanguage}`, `**رنگ، نور و حس:** ${scenario.visualBible.colorLightingMood}`, `**قانون‌های ثابت‌ماندن ظاهر:** ${scenario.visualBible.consistencyRules}`] : []),
    '', '## شخصیت‌های داستان'
  ];
  scenario.characters.forEach((character) => {
    lines.push(`### ${character.id}: ${character.name}`, `**نقش:** ${character.role || character.relationship}`, `**ظاهر و ویژگی‌ها:** ${character.description}`, ...(scenario.schemaVersion === 2 ? [`**سنِ ظاهری و گونه:** ${character.apparentAge}؛ ${character.speciesType}`, `**اندام و نسبت‌ها:** ${character.bodyProportions}`, `**چهره و چشم‌ها:** ${character.face}؛ ${character.eyes}`, `**مو یا پوشش بدن:** ${character.hairOrFur}`, `**لباس و اکسسوری:** ${character.clothing}؛ ${character.accessories}`, `**رنگ‌ها و نشانه‌های ویژه:** ${character.colors}؛ ${character.uniqueVisualTraits}`, `**حالت‌ها و زبان بدن:** ${character.expressions}؛ ${character.bodyLanguage}`, `**هدف و ترس:** ${character.goalsFears}`, `**قانون‌های ثابت‌ماندن:** ${character.consistencyRules}`] : []), `**رفتار و اخلاق:** ${character.personality}`, `**تواناییِ ویژه:** ${character.specialAbility}`, `**رابطه با قهرمان:** ${character.relationship}`, `**نشانه‌ی ظاهریِ ثابت:** ${character.visualSignature}`, `**چیزی که می‌خواهد:** ${character.goal}`, `**شیوه‌ی حرف‌زدن:** ${character.voiceStyle}`, '');
  });
  if (scenario.schemaVersion === 2) {
    lines.push('## مکان‌ها و وسایل مهم');
    scenario.locations.forEach((location) => lines.push(`### ${location.id}: ${location.name}`, `**توصیف:** ${location.description}`, `**جزئیات محیط:** ${location.environmentDetails}`, `**زمان و هوا:** ${location.timeWeather}`, `**نور:** ${location.lighting}`, `**قانون تداوم:** ${location.continuityRules}`, ''));
    scenario.props.forEach((prop) => lines.push(`### ${prop.id}: ${prop.name}`, `**توصیف:** ${prop.description}`, `**صاحب یا جای آغاز:** ${prop.ownerOrLocation}`, `**وضعیت آغاز:** ${prop.initialState}`, `**قانون تداوم:** ${prop.consistencyRules}`, ''));
  }
  lines.push('## مسیر داستان', `**شروع:** ${scenario.storyBeats.setup}`, `**چیزی که قهرمان می‌خواهد:** ${scenario.storyBeats.goal}`, `**مشکل اصلی:** ${scenario.storyBeats.obstacle}`, `**هیجان‌انگیزترین بخش:** ${scenario.storyBeats.climax}`, `**پایان ماجرا:** ${scenario.storyBeats.resolution}`, '', '## داستان، بخش‌به‌بخش');
  scenario.scenes.forEach((scene) => {
    lines.push(
      `### ${scene.id} — بخش ${scene.number}: ${scene.title}`,
      ...(scenario.schemaVersion === 2 ? [`**مکان:** ${scene.locationId}`, `**شخصیت‌ها با شناسه:** ${scene.characterIds.join('، ')}`, `**هدف دیداری:** ${scene.visualIntent}`] : []),
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
      ...(scenario.schemaVersion === 2 ? [`**وضعیت در آغاز:** ${scene.startState}`, `**وضعیت در پایان:** ${scene.endState}`, ...(scene.propStates ? [`**وضعیت وسایل:** ${scene.propStates}`] : [])] : []),
      `**نتیجه‌ی این بخش:** ${scene.outcome}`,
      `**رفتن به بخش بعد:** ${scene.transition}`,
      `**متنِ ساخت تصویر یا ویدیو:** ${scene.imagePrompt}`,
      ''
    );
  });
  lines.push('## پایان داستان', scenario.ending);
  return lines.join('\n');
}

const friendlyCharacterIcons = ['🐻', '🦊', '🐰', '🐱', '🐼', '🦄', '🐿️', '🐸'];

const friendlyClean = (value, max = 500) => clean(value, max)
  .replace(/\b(?:C|L|P|SC)\d{2}\b/gi, '')
  .replace(/هدف دیداری|قانون‌های ثابت‌ماندن(?: ظاهر)?|وضعیت(?: در)?(?: آغاز| پایان)/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

function buildKidFriendlyScenarioMarkdown(scenario) {
  const lines = [
    `# ${friendlyClean(scenario.title, 100) || 'داستان تازه‌ی ما'}`,
    '',
    '## قصه درباره‌ی چیست؟',
    `**برای:** ${friendlyClean(scenario.audience, 120)}`,
    `**مدت قصه:** ${friendlyClean(scenario.duration, 80)}`,
    `**اتفاق هیجان‌انگیز شروع:** ${friendlyClean(scenario.openingHook, 180)}`,
    `**خلاصه‌ی قصه:** ${friendlyClean(scenario.logline, 260)}`,
    `**حرف قشنگ قصه:** ${friendlyClean(scenario.message, 180)}`,
    `**دنیای قصه:** ${friendlyClean(scenario.world, 240)}`,
    `**حال‌وهوای تصویرها:** ${friendlyClean(scenario.visualStyle, 160)}`,
    '',
    '## آدم‌ها و دوست‌های قصه'
  ];

  scenario.characters.forEach((character, index) => {
    const role = friendlyClean(character.role || character.relationship, 100);
    const descriptor = /رقیب|حریف|مخالف/.test(role)
      ? 'رقیب بامزه‌ی داستان'
      : index === 0
        ? 'قهرمان کوچک داستان'
        : role || 'دوست قصه';
    const appearance = [
      friendlyClean(character.description, 180),
      friendlyClean(character.clothing, 180),
      friendlyClean(character.accessories, 140),
      friendlyClean(character.colors, 140),
      friendlyClean(character.uniqueVisualTraits, 180)
    ].filter(Boolean).join('؛ ');
    lines.push(
      `### ${friendlyCharacterIcons[index % friendlyCharacterIcons.length]} ${friendlyClean(character.name, 60) || 'شخصیت قصه'}، ${descriptor}`,
      `**ظاهرش:** ${appearance || friendlyClean(character.visualSignature, 140)}`,
      `**رفتار و توانایی‌اش:** ${friendlyClean(character.personality, 160)}${character.specialAbility ? `؛ ${friendlyClean(character.specialAbility, 160)}` : ''}`,
      `**چیزی که می‌خواهد:** ${friendlyClean(character.goal, 140)}`,
      `**صدای او:** ${friendlyClean(character.voiceStyle, 100)}`,
      ''
    );
  });

  if (scenario.schemaVersion === 2 && scenario.locations.length) {
    lines.push('## جاهای مهم قصه');
    scenario.locations.forEach((location) => lines.push(
      `### ${friendlyClean(location.name, 100)}`,
      friendlyClean(location.description, 240),
      `هوای قصه: ${friendlyClean(location.timeWeather, 140)}؛ نور: ${friendlyClean(location.lighting, 160)}`,
      ''
    ));
  }

  lines.push(
    '## مسیر ماجرا',
    `**اول ماجرا:** ${friendlyClean(scenario.storyBeats.setup, 240)}`,
    `**قهرمان چه می‌خواهد؟** ${friendlyClean(scenario.storyBeats.goal, 180)}`,
    `**چه دردسری پیش می‌آید؟** ${friendlyClean(scenario.storyBeats.obstacle, 200)}`,
    `**هیجان‌انگیزترین لحظه:** ${friendlyClean(scenario.storyBeats.climax, 220)}`,
    `**پایان شیرین:** ${friendlyClean(scenario.storyBeats.resolution, 220)}`,
    '',
    '## قصه، قدم‌به‌قدم'
  );

  scenario.scenes.forEach((scene, index) => {
    lines.push(
      `### بخش ${index + 1}: ${friendlyClean(scene.title, 100) || 'ادامه‌ی ماجرا'}`,
      `**زمان:** ${friendlyClean(scene.duration, 80)}`,
      `**کجا هستیم؟** ${friendlyClean(scene.setting, 420)}`,
      `**چه می‌بینیم؟** ${friendlyClean(scene.visual, 420)}`,
      `**چه اتفاقی می‌افتد؟** ${friendlyClean(scene.action, 420)}`,
      ...(scene.dialogue ? [`**حرف شخصیت‌ها:** ${friendlyClean(scene.dialogue, 420)}`] : []),
      ...(scene.narration ? [`**صدای قصه‌گو:** ${friendlyClean(scene.narration, 420)}`] : []),
      `**واکنش‌ها:** ${friendlyClean(scene.reaction, 420)}`,
      `**صداهای بامزه:** ${friendlyClean(scene.sound, 420)}`,
      `**نتیجه‌ی این بخش:** ${friendlyClean(scene.outcome, 420)}`,
      ...(scene.transition ? [`**بعدش:** ${friendlyClean(scene.transition, 420)}`] : []),
      ''
    );
  });

  lines.push('## پایان قصه', friendlyClean(scenario.ending, 320));
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
    'تمام فیلدهای سناریو باید کامل بمانند، از جمله راهنمای یکپارچه‌ی ساخت، شناسه‌های ثابت، شناسنامه‌ی کامل شخصیت، مکان‌ها و وسایل مهم، و برای هر بخش زمان، شخصیت‌ها، مکان، حس، هدف دیداری، وضعیت آغاز و پایان، پیوستگی و نتیجه.',
    'اگر داستان به مانع زنده یا رقیب نیاز دارد، به‌جای موجودات کلی مانند «زنبورها» یک رقیب بامزه و مشخص با نام، انگیزه، ظاهر قابل‌تشخیص و عادت خنده‌دار بساز و نقش واقعی او را حفظ کن.',
    'تلاش ناموفق را با کمدی فیزیکی و اسلپ‌استیک امن اصلاح کن؛ لیزخوردن بی‌خطر روی برگ خیس، گیرکردن کلاه یا وارونه آویزان‌شدن بامزه مجاز است، اما آسیب، ترساندن و تحقیر ممنوع است.',
    'پیروزی نباید با فریب، زورگویی، دزدی یا برداشتن بدون اجازه رخ دهد. گره‌گشایی را بر همکاری، کمک متقابل، هوش، جبران یا اجازه گرفتن بنا کن و راه اخلاقی را در outcome و ending قابل‌دیدن نشان بده.',
    'دیالوگ‌ها را کوتاه، عامیانه، پرانرژی و متناسب با سن نگه دار؛ عبارت‌های کتابی مانند «آه! به‌به!» و جمله‌های رسمی ممنوع‌اند. افکت‌های کارتونی مشخص مانند «پِلَخ»، «وُوووش» و «تاپ‌تاپ» را در sound بگذار، نه در دیالوگ، و از تکرار بی‌دلیل «یامی» یا «هوووررا» پرهیز کن.',
    'برای هر شخصیت، رفتار و اخلاق، تواناییِ ویژه، رابطه با قهرمان و نشانه‌ی ظاهریِ ثابت را نگه دار یا بهتر کن. دوست‌های قهرمان باید نقشِ واقعی و تواناییِ متفاوت داشته باشند؛ شخصیتِ تزئینی نساز.',
    'شناسه‌های C، L، P و SC را تغییر نده و هر ارجاع را معتبر نگه دار. راهنمای یکپارچه‌ی ساخت، نام، ظاهر، هدف و لحن شخصیت‌ها را حفظ کن. هر صحنه باید از نتیجه‌ی صحنه‌ی قبل آغاز شود و outcome آن، علت روشنِ صحنه‌ی بعد باشد. واکنش شخصیت‌ها را قابل‌دیدن و اثرگذار نگه دار.',
    'همه‌ی متن‌ها فارسیِ معیار باشند. در دیالوگ و نریشن، برای تلفظ بی‌ابهام از کسره‌ی اضافه، همزه و حرکت‌های لازمِ فارسی/عربی استفاده کن؛ فقط اعراب‌گذاریِ درست و ضروری مجاز است.',
    'خروجی برای کاربر عادی است؛ در مقدار فیلدها از اصطلاحات فنی و خارجی مانند لاگ‌لاین، تایم‌لاین، بیت، شات، پلان، کات، نریشن و پرامپت استفاده نکن و همان مفهوم را با فارسیِ ساده بنویس.',
    scope,
    `درخواست کاربر: ${clean(request, 500)}`,
    'سناریوی فعلی:',
    JSON.stringify(scenario)
  ].join('\n\n');
}

module.exports = { buildKidFriendlyScenarioMarkdown, buildRepairPrompt, buildRevisionPrompt, buildScenarioMarkdown, normalizeScenario, parseJsonObject, validateScenario };
