'use strict';

const clean = (value, maximum = 400) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, maximum);

function normalizeSourceScenes(value) {
  const items = Array.isArray(value) ? value : [];
  return items.slice(0, 24).map((scene, index) => ({
    id: clean(scene?.id, 80) || `scene-${index + 1}`,
    number: Number.isSafeInteger(scene?.number) ? scene.number : index + 1,
    title: clean(scene?.title, 120) || `صحنه ${index + 1}`,
    description: clean(scene?.description, 700),
    action: clean(scene?.action, 500),
    camera: clean(scene?.camera, 240),
    dialogue: clean(scene?.dialogue, 420),
    mood: clean(scene?.mood, 160),
    imageUrl: clean(scene?.imageUrl, 1600) || null
  })).filter((scene) => scene.description || scene.action || scene.imageUrl);
}

function buildPlanningPrompt({ title, scenario, aspectRatio, scenes }) {
  return [
    'تو کارگردان، سوپروایزر تداوم تصویر و تدوین‌گر یک ویدیوی داستانی هستی. «سناریو» حقیقت روایی و «هر قاب استوری‌برد» مرجع تصویری همان صحنه است.',
    'قانون قطعی نگاشت: هر قاب ورودی دقیقاً یک خروجی scenes دارد. هیچ قاب یا رخداد سناریو را حذف، ادغام، خرد، تکرار یا جابه‌جا نکن. sourceSceneId را بدون تغییر برگردان. ترتیب خروجی دقیقاً ترتیب ورودی است.',
    'قانون قطعی محتوا: فقط اتفاقی را بساز که در سناریو یا توضیح همان قاب آمده است. رخداد، شخصیت، دیالوگ، لباس، شیء مهم، مکان، زمان یا پایان تازه اختراع نکن. اگر جزئیاتی نامشخص است، آن را خنثی و محافظه‌کارانه نگه دار.',
    'تداوم تصویری: چهره، سن، لباس، رنگ لباس، مو، اکسسوری، اشیای کلیدی، چیدمان محیط، نور، آب‌وهوا، زمان روز، سبک بصری و جهت حرکت شخصیت‌ها باید از یک صحنه به صحنهٔ بعد حفظ شوند. فقط وقتی سناریو تغییر را صریح گفته، تغییر بده.',
    'حرکت و دوربین باید کوچک، قابل‌تولید و متناسب با قاب باشد؛ از تغییر ناگهانی چهره/لباس، تلپورت، حرکت بسیار سریع، کات بی‌دلیل و تغییر سبک جلوگیری کن. برای هر صحنه یک حرکت اصلی روشن انتخاب کن.',
    'اتصال صحنه‌ها باید داستانی و نرم باشد: حرکت، جهت نگاه، صدا، نور یا شیء مشترک را تا حد ممکن به صحنهٔ بعد وصل کن. در صحنهٔ اول transition باید شروع مستقیم از قاب باشد.',
    'صدا: دیالوگ‌های موجود را عیناً در audioDirection ذکر کن و دیالوگ یا نریشن تازه نساز. اگر دیالوگ وجود ندارد فقط موسیقی/افکت متناسب با همان صحنه پیشنهاد بده. زیرنویس، متن روی تصویر، لوگو و واترمارک نساز.',
    'videoPrompt باید دستور حرفه‌ای و خودبسنده برای ساخت همان یک کلیپ باشد: مرجع قاب، هویت ثابت شخصیت/محیط، اتفاق، حرکت، دوربین، نور/حس، تداوم با قبل و منع متن/لوگو/واترمارک را روشن کند.',
    'فقط JSON معتبر با این ساختار برگردان: {"title":"","summary":"","audioDirection":"","scenes":[{"sourceSceneId":"","durationSeconds":4,"action":"","camera":"","transition":"","audioDirection":"","videoPrompt":""}]}.',
    'تعداد scenes باید دقیقاً با صحنه‌های ورودی برابر باشد، هیچ شناسه‌ای تکراری نباشد و sourceSceneId هر مورد دقیقاً یکی از شناسه‌های ورودی باشد.',
    `عنوان: ${title || 'ویدیوی من'}`,
    `نسبت تصویر: ${aspectRatio}`,
    `سناریو:\n${scenario}`,
    'صحنه‌های استوری‌برد:',
    JSON.stringify(scenes.map(({ id, number, title: sceneTitle, description, action, camera, dialogue, mood }) => ({ id, number, title: sceneTitle, description, action, camera, dialogue, mood })))
  ].join('\n\n');
}

function fallbackPlan({ title, scenes }) {
  return {
    title: title || 'ویدیوی استوری‌برد',
    summary: 'صحنه‌ها به همان ترتیب استوری‌برد تولید و با اتصال نرم به هم مونتاژ می‌شوند.',
    audioDirection: 'موسیقی و افکت‌های ملایم متناسب با ریتم داستان؛ فقط دیالوگ‌های موجود در سناریو استفاده می‌شوند.',
    scenes: scenes.map((scene, index) => ({
      sourceSceneId: scene.id,
      durationSeconds: 5,
      action: scene.action || scene.description,
      camera: scene.camera || 'حرکت آرام دوربین مطابق قاب استوری‌برد',
      transition: index === 0 ? 'شروع مستقیم از قاب' : 'اتصال نرم از صحنهٔ قبل',
      audioDirection: scene.dialogue ? `دیالوگ: ${scene.dialogue}` : `افکت و موسیقی متناسب با حس ${scene.mood || 'داستان'}`,
      videoPrompt: [
        'Use the supplied storyboard frame as the exact visual reference.',
        scene.description,
        scene.action,
        scene.camera,
        scene.mood ? `Mood and lighting: ${scene.mood}.` : '',
        'Preserve character identity, wardrobe, props, environment and visual style from adjacent scenes.',
        'No new characters or events, no on-screen text, subtitles, logos or watermark.'
      ].filter(Boolean).join(' ')
    }))
  };
}

function normalizePlan(value, source) {
  const fallback = fallbackPlan(source);
  const raw = value && typeof value === 'object' ? value : {};
  const byId = new Map(source.scenes.map((scene) => [scene.id, scene]));
  const supplied = Array.isArray(raw.scenes) ? raw.scenes : [];
  const parsed = supplied.map((item) => {
    const sourceSceneId = clean(item?.sourceSceneId, 80);
    if (!byId.has(sourceSceneId)) return null;
    const base = byId.get(sourceSceneId);
    return {
      sourceSceneId,
      durationSeconds: Math.max(2, Math.min(12, Math.round(Number(item?.durationSeconds) || 5))),
      action: clean(item?.action, 500) || base.action || base.description,
      camera: clean(item?.camera, 240) || base.camera || 'حرکت آرام دوربین مطابق قاب استوری‌برد',
      transition: clean(item?.transition, 180) || 'اتصال نرم به صحنهٔ بعد',
      audioDirection: clean(item?.audioDirection, 420) || (base.dialogue ? `دیالوگ: ${base.dialogue}` : fallback.audioDirection),
      videoPrompt: clean(item?.videoPrompt, 2800) || fallback.scenes.find((scene) => scene.sourceSceneId === sourceSceneId).videoPrompt
    };
  }).filter(Boolean);
  if (parsed.length !== source.scenes.length || new Set(parsed.map((scene) => scene.sourceSceneId)).size !== source.scenes.length) return fallback;
  return {
    title: clean(raw.title, 120) || fallback.title,
    summary: clean(raw.summary, 420) || fallback.summary,
    audioDirection: clean(raw.audioDirection, 420) || fallback.audioDirection,
    scenes: source.scenes.map((scene) => parsed.find((item) => item.sourceSceneId === scene.id))
  };
}

module.exports = { clean, normalizeSourceScenes, buildPlanningPrompt, fallbackPlan, normalizePlan };
