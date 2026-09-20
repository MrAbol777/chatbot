import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Button, TextAreaField, TextField, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import { createAnimationProject, getAnimationProject, listAnimationProjects, transitionAnimationProject, updateAnimationProject, uploadAnimationReference } from './animationMaker.api';
import { createAnimationProjectInput, type AnimationAudio, type AnimationProject, type AnimationProjectInput, type AnimationProjectSummary } from './animationMaker.types';
import { createStoryWorkspace, generateStoryScenario, getStoryWorkspace, reviseStoryScenario, updateStoryWorkspace } from '../story-maker/storyMaker.api';
import type { StoryContext, StoryDraft, StoryWorkspace } from '../story-maker/storyMaker.types';
import './AnimationMakerPage.css';

type Props = { onBack: () => void; onOpenCharacterMaker: (scenario: string, title?: string, animation?: { animationProjectId?: string; storyWorkspaceId?: string; scenarioVersion?: string; durationSeconds?: number }) => void };
type QuestionId = 'durationSeconds' | 'style' | 'location' | 'audience' | 'aspectRatio' | 'mood' | 'audio' | 'reference';
type Question = { id: QuestionId; title: string; hint: string; optional?: boolean; options?: Array<{ value: string; label: string; description: string }> };

const questions: Question[] = [
  { id: 'durationSeconds', title: 'فیلمت چقدر طول بکشد؟', hint: 'از کوتاه شروع کن؛ بعداً هم می‌شود بزرگ‌ترش کرد.', options: [
    { value: '5', label: '۵ ثانیه', description: 'خیلی کوتاه و سریع' },
    { value: '10', label: '۱۰ ثانیه', description: 'برای یک اتفاق کوچک' },
    { value: '20', label: '۲۰ ثانیه', description: 'یک ماجرای کوتاه' },
    { value: '30', label: '۳۰ ثانیه', description: 'یک قصهٔ کامل‌تر' },
    { value: 'custom', label: 'مدت دلخواه', description: 'ثانیهٔ دلخواهت را بنویس (۲ تا ۱۸۰ ثانیه)' }
  ] },
  { id: 'style', title: 'فیلمت چه شکلی باشد؟', hint: 'یک سبک را انتخاب کن؛ همهٔ صحنه‌ها همان شکل می‌مانند.', options: [{ value: 'animated', label: 'انیمیشنی', description: 'نرم و رنگی' }, { value: 'three-dimensional', label: 'سه‌بعدی', description: 'حجمی و پرجزئیات' }, { value: 'cinematic', label: 'سینمایی', description: 'قاب‌های چشمگیر' }, { value: 'cartoon', label: 'کارتونی', description: 'بامزه و پرانرژی' }, { value: 'stop-motion', label: 'استاپ‌موشن', description: 'مثل عروسک‌های واقعی' }, { value: 'realistic', label: 'واقع‌گرایانه', description: 'نزدیک به دنیای واقعی' }] },
  { id: 'location', title: 'داستان کجا اتفاق می‌افتد؟', hint: 'می‌توانی یک جای ساده مثل جنگل یا مدرسه بنویسی.', optional: true },
  { id: 'audience', title: 'این فیلم برای چه کسی است؟', hint: 'با این انتخاب، زبان داستان درست‌تر می‌شود.', options: [{ value: 'preschool', label: '۳ تا ۵ سال', description: 'خیلی ساده و آرام' }, { value: 'children', label: '۶ تا ۸ سال', description: 'شاد و قابل‌فهم' }, { value: 'preteen', label: '۹ تا ۱۲ سال', description: 'ماجراجویانه‌تر' }, { value: 'teen', label: 'نوجوان', description: 'کمی عمیق‌تر' }, { value: 'family', label: 'همهٔ خانواده', description: 'برای باهم دیدن' }] },
  { id: 'aspectRatio', title: 'فیلمت را کجا می‌بینی؟', hint: 'شکل صفحه را برای نمایش بهتر انتخاب کن.', options: [{ value: '9:16', label: 'عمودی', description: 'برای موبایل و استوری' }, { value: '16:9', label: 'افقی', description: 'برای تلویزیون و یوتیوب' }, { value: '1:1', label: 'مربع', description: 'برای پست‌ها' }] },
  { id: 'mood', title: 'حس داستانت چیست؟', hint: 'حس اصلی کمک می‌کند موسیقی و رنگ‌ها هماهنگ شوند.', options: [{ value: 'happy', label: 'شاد', description: 'روشن و امیدوار' }, { value: 'emotional', label: 'احساسی', description: 'مهربان و گرم' }, { value: 'adventure', label: 'ماجراجویانه', description: 'پر از کشف' }, { value: 'educational', label: 'آموزشی', description: 'با یک نکتهٔ خوب' }, { value: 'funny', label: 'خنده‌دار', description: 'بامزه و بازیگوش' }, { value: 'mystery', label: 'رازآلود', description: 'کنجکاوی‌برانگیز، نه ترسناک' }] },
  { id: 'audio', title: 'دوست داری چه صدایی داشته باشد؟', hint: 'می‌توانی بیش از یک گزینه انتخاب کنی.', optional: true, options: [{ value: 'narrator', label: 'گوینده', description: 'قصه را تعریف می‌کند' }, { value: 'dialogue', label: 'دیالوگ', description: 'شخصیت‌ها حرف می‌زنند' }, { value: 'music', label: 'موسیقی', description: 'فضا را جذاب می‌کند' }, { value: 'subtitles', label: 'زیرنویس', description: 'خواندن را آسان می‌کند' }, { value: 'silent', label: 'بدون صدا', description: 'فقط تصویر' }] },
  { id: 'reference', title: 'می‌خواهی شخصیت شبیه کسی باشد؟', hint: 'اختیاری است. عکس داری؟ اضافه کن؛ نداری؟ فقط «بدون عکس ادامه بده» را بزن.', optional: true }
];

const defaults: Record<QuestionId, string | string[]> = { durationSeconds: '10', style: 'animated', location: '', audience: 'children', aspectRatio: '9:16', mood: 'happy', audio: ['music'], reference: '' };
const locationSuggestions = ['جنگل جادویی', 'حیاط مدرسه', 'ساحل دریا', 'یک قلعه روی ابرها'];
const labels: Record<string, string> = { animated: 'انیمیشنی', 'three-dimensional': 'سه‌بعدی', realistic: 'واقع‌گرایانه', cinematic: 'سینمایی', cartoon: 'کارتونی', 'stop-motion': 'استاپ‌موشن', preschool: '۳ تا ۵ سال', children: '۶ تا ۸ سال', preteen: '۹ تا ۱۲ سال', teen: 'نوجوان', family: 'همهٔ خانواده', happy: 'شاد', emotional: 'احساسی', adventure: 'ماجراجویانه', educational: 'آموزشی', funny: 'خنده‌دار', mystery: 'رازآلود', narrator: 'گوینده', dialogue: 'دیالوگ', music: 'موسیقی', subtitles: 'زیرنویس', silent: 'بدون صدا' };

function toInput(project: AnimationProject): AnimationProjectInput {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = project;
  return input;
}

function toStoryDraft(project: AnimationProject): StoryDraft {
  const seconds = project.preferences.durationSeconds;
  const mood = project.preferences.mood;
  return {
    idea: project.userInput.idea,
    heroName: '', companionName: '',
    mood: mood === 'funny' ? 'funny' : mood === 'mystery' ? 'mystery' : mood === 'adventure' ? 'adventure' : 'magical',
    place: project.preferences.location ? 'custom' : 'forest',
    customPlace: project.preferences.location,
    length: seconds <= 10 ? 'short' : seconds <= 25 ? 'medium' : 'custom',
    customSceneCount: String(seconds <= 8 ? 2 : seconds <= 15 ? 3 : seconds <= 30 ? 4 : seconds <= 45 ? 6 : 8),
    ending: mood === 'mystery' ? 'surprising' : 'happy',
    customEnding: ''
  };
}

function toStoryContext(project: AnimationProject): StoryContext {
  const preferences = project.preferences;
  return {
    summary: project.userInput.idea,
    resolvedDetails: [
      { label: 'مدت', value: `${preferences.durationSeconds} ثانیه` },
      { label: 'سبک', value: labels[preferences.style] || 'به انتخاب دانوآ' },
      { label: 'گروه سنی', value: labels[preferences.audience] || 'کودک' },
      { label: 'نسبت تصویر', value: preferences.aspectRatio },
      { label: 'حال‌وهوا', value: labels[preferences.mood] || 'شاد' },
      { label: 'صدا', value: preferences.audio.map((item) => labels[item]).join('، ') || 'به انتخاب دانوآ' }
    ],
    assumptions: [],
    answers: {
      'مدت فیلم': `${preferences.durationSeconds} ثانیه`,
      'سبک بصری': labels[preferences.style] || 'به انتخاب دانوآ',
      'گروه سنی': labels[preferences.audience] || 'کودک',
      'نسبت تصویر': preferences.aspectRatio,
      'حال‌وهوا': labels[preferences.mood] || 'شاد',
      'صدا': preferences.audio.map((item) => labels[item]).join('، ') || 'به انتخاب دانوآ'
    }
  };
}

export default function AnimationMakerPage({ onBack, onOpenCharacterMaker }: Props) {
  const { notify } = useNotification();
  const [mode, setMode] = useState<'welcome' | 'idea' | 'questions' | 'summary'>('welcome');
  const [idea, setIdea] = useState('');
  const [project, setProject] = useState<AnimationProject | null>(null);
  const [projects, setProjects] = useState<AnimationProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [locationDraft, setLocationDraft] = useState('');
  const [isWritingLocation, setIsWritingLocation] = useState(false);
  const [customDurationDraft, setCustomDurationDraft] = useState('');
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [storyWorkspace, setStoryWorkspace] = useState<StoryWorkspace | null>(null);
  const [revisionRequest, setRevisionRequest] = useState('');
  const activeQuestion = questions[project?.currentStep || 0];
  const progress = project ? `${Math.min(project.currentStep + 1, questions.length)} از ${questions.length}` : '';

  useEffect(() => {
    let active = true;
    void listAnimationProjects().then((items) => { if (active) setProjects(items); }).catch(() => { /* First-time users can still create a project. */ });
    return () => { active = false; };
  }, []);

  const summaryRows = useMemo(() => project ? [
    ['ایده', project.userInput.idea],
    ['مدت', `${project.preferences.durationSeconds} ثانیه`],
    ['سبک', labels[project.preferences.style] || 'به انتخاب دانوآ'],
    ['مکان', project.preferences.location || 'به انتخاب دانوآ'],
    ['گروه سنی', labels[project.preferences.audience] || 'به انتخاب دانوآ'],
    ['نسبت تصویر', project.preferences.aspectRatio],
    ['حال‌وهوا', labels[project.preferences.mood] || 'به انتخاب دانوآ'],
    ['صدا', project.preferences.audio.length ? project.preferences.audio.map((item) => labels[item]).join('، ') : 'به انتخاب دانوآ']
  ] : [], [project]);

  const persist = async (next: AnimationProjectInput, nextMode: typeof mode) => {
    if (!project) return;
    setIsSaving(true); setError('');
    try {
      const saved = await updateAnimationProject(project.id, next);
      setProject(saved); setMode(nextMode);
      setProjects((items) => [{ id: saved.id, title: saved.title, idea: saved.userInput.idea, stage: saved.stage, status: saved.status, createdAt: saved.createdAt, updatedAt: saved.updatedAt }, ...items.filter((item) => item.id !== saved.id)]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'ذخیرهٔ پروژه انجام نشد.'); }
    finally { setIsSaving(false); }
  };

  const startProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!idea.trim()) { setError('ایده‌ات را، حتی کوتاه، بنویس.'); return; }
    setIsSaving(true); setError('');
    try {
      const saved = await createAnimationProject(createAnimationProjectInput(idea));
      setProject(saved); setMode('questions');
      setIsCustomDuration(false); setCustomDurationDraft('');
      setProjects((items) => [{ id: saved.id, title: saved.title, idea: saved.userInput.idea, stage: saved.stage, status: saved.status, createdAt: saved.createdAt, updatedAt: saved.updatedAt }, ...items.filter((item) => item.id !== saved.id)]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'شروع پروژه انجام نشد.'); }
    finally { setIsSaving(false); }
  };

  const answerQuestion = (value: string, auto = false) => {
    if (!project || !activeQuestion) return;
    if (activeQuestion.id === 'durationSeconds' && value === 'custom') {
      setIsCustomDuration(true);
      if (!customDurationDraft) {
        setCustomDurationDraft(String(project.preferences.durationSeconds || '15'));
      }
      return;
    }
    setIsCustomDuration(false);
    const next = toInput(project);
    const preferences = { ...next.preferences };
    if (activeQuestion.id === 'durationSeconds') preferences.durationSeconds = Number(value);
    else if (activeQuestion.id === 'audio') {
      const selected = preferences.audio.includes(value as AnimationAudio);
      preferences.audio = value === 'silent' ? ['silent'] : (selected ? preferences.audio.filter((item) => item !== value) : [...preferences.audio.filter((item) => item !== 'silent'), value as AnimationAudio]);
      setProject({ ...project, preferences });
      return;
    } else if (activeQuestion.id === 'location') {
      preferences.location = value;
    } else if (activeQuestion.id !== 'reference') {
      (preferences as Record<string, unknown>)[activeQuestion.id] = value;
    }
    next.preferences = preferences;
    next.currentStep = Math.min(project.currentStep + 1, questions.length);
    next.stage = next.currentStep >= questions.length ? 'summary' : 'questions';
    void persist(next, next.stage === 'summary' ? 'summary' : 'questions');
    if (auto) notify.info('دانوآ این انتخاب را برای شروع گذاشت؛ هر وقت خواستی می‌توانی تغییرش دهی.');
  };

  const continueQuestion = () => {
    if (!project || !activeQuestion) return;
    if (activeQuestion.id === 'durationSeconds') {
      const parsed = Number.parseInt(customDurationDraft.trim(), 10);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 180) {
        setError('لطفاً عددی بین ۲ تا ۱۸۰ ثانیه بنویس.');
        return;
      }
      answerQuestion(String(parsed));
      return;
    }
    if (activeQuestion.id === 'audio') {
      const next = toInput(project);
      next.currentStep = Math.min(project.currentStep + 1, questions.length);
      next.stage = next.currentStep >= questions.length ? 'summary' : 'questions';
      void persist(next, next.stage === 'summary' ? 'summary' : 'questions');
      return;
    }
    if (activeQuestion.id === 'location') { answerQuestion(locationDraft.trim()); return; }
    if (activeQuestion.id === 'reference') { answerQuestion(''); return; }
  };

  const chooseForMe = () => {
    const fallback = defaults[activeQuestion.id];
    if (activeQuestion.id === 'durationSeconds') {
      setIsCustomDuration(false);
      setCustomDurationDraft('');
      answerQuestion(String(fallback), true);
      return;
    }
    if (activeQuestion.id === 'location') { setLocationDraft(''); setIsWritingLocation(false); answerQuestion('', true); return; }
    if (activeQuestion.id === 'audio') {
      if (!project) return;
      const next = toInput(project);
      next.preferences.audio = fallback as AnimationAudio[];
      next.currentStep = Math.min(project.currentStep + 1, questions.length);
      next.stage = next.currentStep >= questions.length ? 'summary' : 'questions';
      void persist(next, next.stage === 'summary' ? 'summary' : 'questions');
      return;
    }
    answerQuestion(String(fallback), true);
  };

  const previousQuestion = () => {
    if (!project) return;
    if (project.currentStep === 0) { setMode('idea'); return; }
    const next = toInput(project);
    next.currentStep -= 1; next.stage = 'questions';
    void persist(next, 'questions');
  };

  const selectReference = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !project) return;
    if (!file.type.startsWith('image/')) { setError('فقط یک تصویر انتخاب کن.'); return; }
    setIsSaving(true); setError('');
    try {
      const imageId = await uploadAnimationReference(file);
      const next = toInput(project);
      next.userInput.referenceImageIds = [...next.userInput.referenceImageIds, imageId].slice(0, 3);
      const saved = await updateAnimationProject(project.id, next);
      setProject(saved);
      notify.success('تصویر مرجع به پروژه اضافه شد.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'آپلود تصویر انجام نشد.'); }
    finally { setIsSaving(false); event.target.value = ''; }
  };

  const resumeProject = async (id: string) => {
    setIsLoading(true); setError('');
    try {
      const saved = await getAnimationProject(id);
      setProject(saved); setIdea(saved.userInput.idea); setLocationDraft(saved.preferences.location);
      setIsWritingLocation(Boolean(saved.preferences.location) && !locationSuggestions.includes(saved.preferences.location));
      if (!['5', '10', '20', '30'].includes(String(saved.preferences.durationSeconds))) {
        setIsCustomDuration(true);
        setCustomDurationDraft(String(saved.preferences.durationSeconds));
      } else {
        setIsCustomDuration(false);
        setCustomDurationDraft('');
      }
      if (saved.sourceLinks.storyWorkspaceId) {
        const workspace = await getStoryWorkspace(saved.sourceLinks.storyWorkspaceId);
        setStoryWorkspace(workspace);
      }
      setMode(saved.stage === 'questions' ? 'questions' : saved.stage === 'idea' ? 'idea' : 'summary');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'پروژه باز نشد.'); }
    finally { setIsLoading(false); }
  };

  const generateScenario = async () => {
    if (!project) return;
    setIsSaving(true); setError('');
    try {
      const draft = toStoryDraft(project);
      const generated = await generateStoryScenario(draft, toStoryContext(project));
      const workspace = await createStoryWorkspace({
        title: generated.story.title || project.title,
        idea: project.userInput.idea,
        status: 'completed',
        draft,
        scenario: generated.scenario,
        story: generated.story,
        versions: [{ id: `animation-initial-${Date.now()}`, createdAt: new Date().toISOString(), label: 'نسخهٔ نخست سناریو', scenario: generated.scenario, story: generated.story }]
      });
      const next = toInput(project);
      next.stage = 'scenario'; next.status = 'active'; next.sourceLinks.storyWorkspaceId = workspace.id;
      const saved = await updateAnimationProject(project.id, next);
      setProject(saved); setStoryWorkspace(workspace);
      notify.success('سناریو با بررسی کیفیت آماده شد.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'ساخت سناریو انجام نشد.'); }
    finally { setIsSaving(false); }
  };

  const reviseScenario = async () => {
    if (!project || !storyWorkspace?.story || !revisionRequest.trim()) { setError('بگو دوست داری چه چیزی تغییر کند.'); return; }
    setIsSaving(true); setError('');
    try {
      const expectedScenes = Number(toStoryDraft(project).customSceneCount) || 3;
      const revised = await reviseStoryScenario(storyWorkspace.story, expectedScenes, revisionRequest.trim());
      const updatedWorkspace = await updateStoryWorkspace(storyWorkspace.id, {
        title: revised.story.title || storyWorkspace.title,
        idea: storyWorkspace.idea,
        status: 'completed',
        draft: storyWorkspace.draft,
        brief: storyWorkspace.brief || null,
        briefAnswers: storyWorkspace.briefAnswers || {},
        plan: storyWorkspace.plan || null,
        characterNames: storyWorkspace.characterNames || [],
        characterDetails: storyWorkspace.characterDetails || [],
        scenario: revised.scenario,
        story: revised.story,
        versions: [...(storyWorkspace.versions || []), { id: `animation-revision-${Date.now()}`, createdAt: new Date().toISOString(), label: 'اصلاح سناریو', scenario: revised.scenario, story: revised.story }]
      });
      const next = toInput(project);
      next.revisions = [...next.revisions, { id: `scenario-${Date.now()}`, stage: 'scenario', request: revisionRequest.trim(), createdAt: new Date().toISOString() }];
      const saved = await updateAnimationProject(project.id, next);
      setProject(saved); setStoryWorkspace(updatedWorkspace); setRevisionRequest('');
      notify.success('اصلاح روی همان سناریو اعمال شد.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'اصلاح سناریو انجام نشد.'); }
    finally { setIsSaving(false); }
  };

  const approveScenario = async () => {
    if (!project || !storyWorkspace?.scenario) return;
    setIsSaving(true); setError('');
    try {
      const saved = await transitionAnimationProject(project.id, 'scenario_approved', { storyWorkspaceId: storyWorkspace.id, scenarioVersion: storyWorkspace.updatedAt || storyWorkspace.createdAt });
      setProject(saved);
      onOpenCharacterMaker(storyWorkspace.scenario, storyWorkspace.title, { animationProjectId: saved.id, storyWorkspaceId: storyWorkspace.id, scenarioVersion: storyWorkspace.updatedAt || storyWorkspace.createdAt, durationSeconds: saved.preferences.durationSeconds });
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'تأیید سناریو ذخیره نشد.'); }
    finally { setIsSaving(false); }
  };

  return (
    <main className="animation-maker" dir="rtl">
      <header className="animation-maker__header">
        <button
          type="button"
          className="animation-maker__back"
          onClick={onBack}
          aria-label="بازگشت به استودیو"
          title="بازگشت به استودیو"
        >
          <Icon name="chevron-right" size={20} aria-hidden="true" />
        </button>
        <div className="animation-maker__brand">
          <span className="animation-maker__brand-icon" aria-hidden="true">
            <Icon name="sparkle" size={18} />
          </span>
          <div className="animation-maker__brand-text">
            <strong>انیمیشن‌سازی</strong>
            <span>فیلمت را قدم‌به‌قدم بساز</span>
          </div>
        </div>
        <div className="animation-maker__header-spacer" aria-hidden="true" />
      </header>

      <section className="animation-maker__content" aria-live="polite">
        {mode === 'welcome' ? (
          <div className="animation-maker__welcome-shell">
            <div className="animation-maker__hero">
              <span className="animation-maker__spark" aria-hidden="true">
                <Icon name="sparkles" size={34} />
              </span>
              <h1>بیایم انیمیشن خودتو بسازیم!</h1>
              <p>ایده‌ات رو بگو؛ حتی اگر یک جمله ساده باشه، قدم‌به‌قدم تبدیلش می‌کنیم به یک فیلم کارتونی قشنگ.</p>
              <Button size="lg" onClick={() => { setError(''); setMode('idea'); }} startIcon={<Icon name="sparkle" size={18} aria-hidden="true" />}>
                شروع ساخت انیمیشن
              </Button>
            </div>
            {projects.length ? (
              <section className="animation-maker__resume" aria-label="پروژه‌های ناتمام">
                <h2>ادامهٔ فیلم‌های من</h2>
                <div className="animation-maker__resume-list">
                  {projects.slice(0, 3).map((item) => (
                    <button key={item.id} type="button" className="animation-maker__resume-card" onClick={() => void resumeProject(item.id)} disabled={isLoading}>
                      <div className="animation-maker__resume-icon" aria-hidden="true">
                        <Icon name="story" size={20} />
                      </div>
                      <div className="animation-maker__resume-info">
                        <strong>{item.title}</strong>
                        <span>{item.stage === 'summary' ? 'آمادهٔ ساخت سناریو' : 'ادامهٔ انتخاب‌ها'}</span>
                      </div>
                      <span className="animation-maker__resume-arrow" aria-hidden="true">
                        <Icon name="chevron-left" size={18} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {mode === 'idea' ? (
          <form className="animation-maker__card animation-maker__idea" onSubmit={startProject}>
            <div className="animation-maker__card-badge">
              <Icon name="sparkle" size={14} aria-hidden="true" />
              <span>قدم اول</span>
            </div>
            <h1>ایده‌ات چیه؟</h1>
            <p>یک جمله هم کافی است. دانوآ کمک می‌کند آن را به فیلم تبدیل کنیم.</p>
            <TextAreaField
              label="ایدهٔ فیلم"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="مثلاً: یک گربه می‌خواهد به دوستش کمک کند."
              rows={6}
              maxLength={2000}
              errorText={error}
            />
            <div className="animation-maker__actions">
              <Button variant="secondary" type="button" onClick={() => setMode('welcome')}>
                بازگشت
              </Button>
              <Button type="submit" size="lg" loading={isSaving}>
                ادامه
              </Button>
            </div>
          </form>
        ) : null}

        {mode === 'questions' && project && activeQuestion ? (
          <section className="animation-maker__card animation-maker__question">
            <div className="animation-maker__progress">
              <div className="animation-maker__progress-top">
                <span className="animation-maker__progress-badge">{progress}</span>
                <span className="animation-maker__progress-title">انتخاب‌های فیلم</span>
              </div>
              <div className="animation-maker__progress-track" aria-hidden="true">
                <i style={{ width: `${((project.currentStep + 1) / questions.length) * 100}%` }} />
              </div>
            </div>

            <div className="animation-maker__question-heading">
              <h1>{activeQuestion.title}</h1>
              <p>{activeQuestion.hint}</p>
            </div>

            {activeQuestion.id === 'audio' ? (
              <div className="animation-maker__multi-hint">
                <Icon name="info-circle" size={16} aria-hidden="true" />
                <span>می‌توانی یک یا چند گزینه را باهم انتخاب کنی</span>
              </div>
            ) : null}

            {activeQuestion.options ? (
              <div className="animation-maker__options">
                {activeQuestion.options.map((option) => {
                  const isCustomActive = isCustomDuration || (activeQuestion.id === 'durationSeconds' && !['5', '10', '20', '30'].includes(String(project.preferences.durationSeconds)));
                  const selected = activeQuestion.id === 'audio'
                    ? project.preferences.audio.includes(option.value as AnimationAudio)
                    : activeQuestion.id === 'durationSeconds'
                      ? (option.value === 'custom' ? isCustomActive : (!isCustomActive && String(project.preferences.durationSeconds) === option.value))
                      : String((project.preferences as Record<string, unknown>)[activeQuestion.id]) === option.value;
                  return (
                    <button
                      className={`animation-maker__option-btn ${selected ? 'is-selected' : ''} ${option.value === 'custom' ? 'animation-maker__option--wide' : ''}`.trim()}
                      type="button"
                      key={option.value}
                      aria-pressed={selected}
                      disabled={isSaving}
                      onClick={() => answerQuestion(option.value)}
                    >
                      <div className="animation-maker__option-text">
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </div>
                      <div className={`animation-maker__indicator ${selected ? 'is-checked' : ''} ${activeQuestion.id === 'audio' ? 'is-checkbox' : 'is-radio'}`} aria-hidden="true">
                        {selected ? <Icon name="check" size={14} /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activeQuestion.id === 'durationSeconds' && (isCustomDuration || !['5', '10', '20', '30'].includes(String(project.preferences.durationSeconds))) ? (
              <div className="animation-maker__custom-duration">
                <TextField
                  label="مدت فیلم به ثانیه"
                  type="number"
                  min={2}
                  max={180}
                  step={1}
                  placeholder="مثلاً: ۱۵"
                  value={customDurationDraft}
                  onChange={(event) => {
                    setCustomDurationDraft(event.target.value);
                    setError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      continueQuestion();
                    }
                  }}
                  helperText="می‌توانی هر عددی بین ۲ تا ۱۸۰ ثانیه بنویسی."
                />
              </div>
            ) : null}

            {activeQuestion.id === 'location' ? (
              <div className="animation-maker__location-choice">
                <p>یکی از جاهای آماده را انتخاب کن یا مکان خودت را بنویس:</p>
                <div className="animation-maker__location-suggestions" role="group" aria-label="مکان‌های پیشنهادی داستان">
                  {locationSuggestions.map((location) => (
                    <button
                      className="animation-maker__location-option"
                      type="button"
                      key={location}
                      disabled={isSaving}
                      onClick={() => { setLocationDraft(location); setIsWritingLocation(false); answerQuestion(location); }}
                    >
                      {location}
                    </button>
                  ))}
                  <button
                    className={`animation-maker__location-option animation-maker__location-option--custom${isWritingLocation ? ' is-selected' : ''}`}
                    type="button"
                    disabled={isSaving}
                    aria-pressed={isWritingLocation}
                    onClick={() => setIsWritingLocation(true)}
                  >
                    خودم می‌نویسم
                  </button>
                </div>
                {isWritingLocation ? (
                  <div className="animation-maker__input-wrap">
                    <TextField
                      label="مکان خودت"
                      placeholder="مثلاً: خانهٔ مادربزرگ، شهر زیر آب یا پارک محله"
                      value={locationDraft}
                      onChange={(event) => setLocationDraft(event.target.value)}
                      maxLength={160}
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          continueQuestion();
                        }
                      }}
                      helperText="بعد از نوشتن، «ثبت مکان و ادامه» را بزن."
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeQuestion.id === 'reference' ? (
              <div className="animation-maker__reference">
                <label className="animation-maker__upload-box">
                  <span className="animation-maker__upload-icon" aria-hidden="true">
                    <Icon name="upload" size={24} />
                  </span>
                  <div className="animation-maker__upload-label">
                    <strong>افزودن عکس مرجع</strong>
                    <small>فقط اگر می‌خواهی شخصیت به یک فرد یا تصویر خاص شبیه باشد</small>
                  </div>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectReference(event)} disabled={isSaving} />
                </label>
                {project.userInput.referenceImageIds.length ? (
                  <div className="animation-maker__upload-badge">
                    <Icon name="check-circle" size={16} aria-hidden="true" />
                    <span>{project.userInput.referenceImageIds.length} تصویر مرجع ذخیره شده است.</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="animation-maker__error" role="alert">{error}</p> : null}

            <div className="animation-maker__actions">
              <Button variant="secondary" type="button" disabled={isSaving} onClick={previousQuestion}>
                برگشت
              </Button>
              <div className="animation-maker__actions-right">
                {activeQuestion.id !== 'reference' && activeQuestion.id !== 'location' ? (
                  <Button variant="ghost" type="button" disabled={isSaving} onClick={chooseForMe} startIcon={<Icon name="sparkle" size={16} aria-hidden="true" />}>
                    دانوآ انتخاب کند
                  </Button>
                ) : null}
                {activeQuestion.optional && activeQuestion.id !== 'reference' && activeQuestion.id !== 'location' ? (
                  <Button variant="ghost" type="button" disabled={isSaving} onClick={continueQuestion}>
                    این بخش را رد کن
                  </Button>
                ) : null}
                {(activeQuestion.id === 'audio' || activeQuestion.id === 'location' || activeQuestion.id === 'reference' || (activeQuestion.id === 'durationSeconds' && (isCustomDuration || !['5', '10', '20', '30'].includes(String(project.preferences.durationSeconds))))) ? (
                  <Button type="button" disabled={isSaving} onClick={continueQuestion}>
                    {activeQuestion.id === 'reference'
                      ? 'بدون عکس ادامه بده'
                      : activeQuestion.id === 'location'
                        ? (isWritingLocation ? 'ثبت مکان و ادامه' : 'بدون انتخاب ادامه بده')
                        : 'ادامه'}
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {mode === 'summary' && project && project.stage !== 'scenario' && project.stage !== 'characters' ? (
          <section className="animation-maker__card animation-maker__summary">
            <div className="animation-maker__card-badge">
              <Icon name="sparkle" size={14} aria-hidden="true" />
              <span>آماده‌ای!</span>
            </div>
            <h1>انتخاب‌هایت را نگاه کن</h1>
            <p>همه چیز آماده است. هر موردی را که خواستی می‌توانی به عقب برگردی و تغییر بدهی.</p>
            <div className="animation-maker__summary-grid">
              {summaryRows.map(([key, value]) => (
                <div className="animation-maker__summary-item" key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </div>
            {error ? <p className="animation-maker__error" role="alert">{error}</p> : null}
            <div className="animation-maker__actions">
              <Button variant="secondary" onClick={previousQuestion} disabled={isSaving}>
                تغییر انتخاب‌ها
              </Button>
              <Button loading={isSaving} onClick={() => void generateScenario()} startIcon={<Icon name="sparkles" size={18} aria-hidden="true" />}>
                ساخت سناریو
              </Button>
            </div>
          </section>
        ) : null}

        {project && storyWorkspace?.story && (project.stage === 'scenario' || project.stage === 'characters') ? (
          <section className="animation-maker__card animation-maker__scenario">
            <div className="animation-maker__card-badge">
              <Icon name="story" size={14} aria-hidden="true" />
              <span>بازبینی سناریو</span>
            </div>
            <h1>{storyWorkspace.story.title}</h1>
            <p className="animation-maker__logline">{storyWorkspace.story.logline}</p>
            <div className="animation-maker__scenario-meta">
              <div className="animation-maker__scenario-meta-item">
                <dt>پیام داستان</dt>
                <dd>{storyWorkspace.story.message}</dd>
              </div>
              <div className="animation-maker__scenario-meta-item">
                <dt>مدت تقریبی</dt>
                <dd>{storyWorkspace.story.duration}</dd>
              </div>
              <div className="animation-maker__scenario-meta-item">
                <dt>صحنه‌ها</dt>
                <dd>{storyWorkspace.story.scenes.length} صحنه با ترتیب مشخص</dd>
              </div>
            </div>
            <details className="animation-maker__scenario-details">
              <summary>
                <Icon name="file-text" size={16} aria-hidden="true" />
                <span>نمایش سناریوی کامل</span>
              </summary>
              <pre>{storyWorkspace.scenario}</pre>
            </details>
            {project.stage === 'scenario' ? (
              <>
                <TextAreaField
                  label="چه چیزی را تغییر بدهیم؟"
                  value={revisionRequest}
                  onChange={(event) => setRevisionRequest(event.target.value)}
                  placeholder="مثلاً: پایانش شادتر شود یا یک شخصیت بامزه اضافه بشه"
                  rows={3}
                  maxLength={1000}
                  errorText={error}
                />
                <div className="animation-maker__actions">
                  <Button variant="secondary" loading={isSaving} onClick={() => void reviseScenario()}>
                    اعمال اصلاح
                  </Button>
                  <Button loading={isSaving} onClick={() => void approveScenario()} startIcon={<Icon name="check" size={18} aria-hidden="true" />}>
                    تأیید سناریو و ساخت کاراکتر
                  </Button>
                </div>
              </>
            ) : (
              <div className="animation-maker__actions">
                <Button onClick={() => onOpenCharacterMaker(storyWorkspace.scenario || '', storyWorkspace.title)}>
                  ادامهٔ ساخت کاراکترها
                </Button>
              </div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
