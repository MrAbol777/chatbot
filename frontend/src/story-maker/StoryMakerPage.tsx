import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Dialog, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import { clarifyStoryBrief, generateStoryScenario, prepareStoryBrief, prepareStoryPreview } from './storyMaker.api';
import StoryEditorDialog from './StoryEditorDialog';
import type { StoryAddedCharacter, StoryBrief, StoryContext, StoryDraft, StoryPlanPreview, StoryScenario, StoryVersion } from './storyMaker.types';
import './StoryMakerPage.css';

type Props = { onBack: () => void };
type StoryTab = 'create' | 'history';
type StoryFlow = 'idea' | 'preview';
type WaitingMode = 'preview' | 'optimization';
type StoryHistoryItem = { id: string; title: string; idea: string; scenario: string; scenes: number; createdAt: string; story?: StoryScenario; versions?: StoryVersion[] };
type StoryPendingItem = { id: string; draft: StoryDraft; brief: StoryBrief; briefAnswers: Record<string, string>; plan: StoryPlanPreview; characterNames: string[]; characterDetails?: StoryAddedCharacter[]; createdAt: string; updatedAt: string };
type CharacterEditorItem = StoryAddedCharacter & { isNew: boolean };
const STORY_HISTORY_STORAGE_KEY = 'danoa-story-history-v1';
const STORY_PENDING_STORAGE_KEY = 'danoa-story-pending-v1';
const initialDraft: StoryDraft = { idea: '', heroName: '', companionName: '', mood: 'adventure', place: 'forest', customPlace: '', length: 'medium', customSceneCount: '', ending: 'happy', customEnding: '' };

function OptionCheck() {
  return <span className="story-maker__option-check" aria-hidden="true"><Icon name="check" size={14} /></span>;
}

function getStoryTitle(scenario: string, heroName: string) {
  const heading = scenario.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || (heroName ? `ماجرای ${heroName}` : 'داستان تازه‌ی من');
}

function formatStoryDate(value: string) {
  return new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function clampDuration(value: number) {
  return Math.max(2, Math.min(60, Math.round(value)));
}

function getDurationSeconds(value: string) {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  const seconds = Number(normalized.match(/\d+/)?.[0]);
  return Number.isFinite(seconds) ? clampDuration(seconds) : 10;
}

function readStoryHistory(): StoryHistoryItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORY_HISTORY_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is StoryHistoryItem => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.idea === 'string' && typeof item.scenario === 'string' && typeof item.scenes === 'number' && typeof item.createdAt === 'string')).slice(0, 24) : [];
  } catch { return []; }
}

function readPendingStories(): StoryPendingItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORY_PENDING_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is StoryPendingItem => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string' && item.draft && typeof item.draft === 'object' && item.brief && typeof item.brief === 'object' && item.plan && typeof item.plan === 'object' && item.briefAnswers && typeof item.briefAnswers === 'object' && Array.isArray(item.characterNames))).slice(0, 24) : [];
  } catch { return []; }
}

export default function StoryMakerPage({ onBack }: Props) {
  const [draft, setDraft] = useState<StoryDraft>(initialDraft);
  const [activeTab, setActiveTab] = useState<StoryTab>('create');
  const [flow, setFlow] = useState<StoryFlow>('idea');
  const [storyHistory, setStoryHistory] = useState<StoryHistoryItem[]>(readStoryHistory);
  const [pendingStories, setPendingStories] = useState<StoryPendingItem[]>(readPendingStories);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);
  const [ideaTouched, setIdeaTouched] = useState(false);
  const [brief, setBrief] = useState<StoryBrief | null>(null);
  const [briefAnswers, setBriefAnswers] = useState<Record<string, string>>({});
  const [briefQuestionIndex, setBriefQuestionIndex] = useState(0);
  const [briefDialogOpen, setBriefDialogOpen] = useState(false);
  const [waitingDialogOpen, setWaitingDialogOpen] = useState(false);
  const [waitingMode, setWaitingMode] = useState<WaitingMode>('preview');
  const waitingRequestRef = useRef<AbortController | null>(null);
  const [isOptimizingIdea, setIsOptimizingIdea] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [briefValidationError, setBriefValidationError] = useState('');
  const [isPreparingBrief, setIsPreparingBrief] = useState(false);
  const [customAnswerOpen, setCustomAnswerOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [answerPickerOpen, setAnswerPickerOpen] = useState(false);
  const [plan, setPlan] = useState<StoryPlanPreview | null>(null);
  const [isPreparingPlan, setIsPreparingPlan] = useState(false);
  const [characterNames, setCharacterNames] = useState<string[]>([]);
  const [characterDetails, setCharacterDetails] = useState<StoryAddedCharacter[]>([]);
  const [characterEditorOpen, setCharacterEditorOpen] = useState(false);
  const [characterNameDraft, setCharacterNameDraft] = useState<CharacterEditorItem[]>([]);
  const [characterError, setCharacterError] = useState('');
  const [scenario, setScenario] = useState('');
  const [scenarioStory, setScenarioStory] = useState<StoryScenario | null>(null);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [scenarioError, setScenarioError] = useState('');
  const [scenarioDialogOpen, setScenarioDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { notify } = useNotification();
  const ideaError = ideaTouched && !draft.idea.trim() ? 'اول ایده‌ی داستان را بنویس.' : '';
  const activeBriefQuestion = brief?.questions[briefQuestionIndex] || null;
  const isDurationQuestion = activeBriefQuestion?.id === 'duration';

  useEffect(() => {
    try { window.localStorage.setItem(STORY_HISTORY_STORAGE_KEY, JSON.stringify(storyHistory.slice(0, 24))); } catch { /* Generation works without storage. */ }
  }, [storyHistory]);

  useEffect(() => {
    try { window.localStorage.setItem(STORY_PENDING_STORAGE_KEY, JSON.stringify(pendingStories.slice(0, 24))); } catch { /* Preview works without storage. */ }
  }, [pendingStories]);

  useEffect(() => {
    if (isDurationQuestion) setDurationSeconds(getDurationSeconds(briefAnswers.duration || ''));
  }, [briefAnswers.duration, isDurationQuestion]);

  const makeContext = (answers = briefAnswers, names = characterNames, details = characterDetails, sourceBrief = brief): StoryContext | undefined => {
    if (!sourceBrief) return undefined;
    return {
      summary: sourceBrief.summary,
      resolvedDetails: sourceBrief.resolvedDetails,
      assumptions: sourceBrief.assumptions,
      answers: Object.fromEntries(sourceBrief.questions.map((question) => [question.question, answers[question.id] || 'به انتخاب دانوآ'])),
      characterNames: names,
      characterDetails: details
    };
  };

  const savePendingStory = (nextPlan: StoryPlanPreview, answers: Record<string, string>, names: string[], details: StoryAddedCharacter[], sourceBrief: StoryBrief, sourceDraft: StoryDraft) => {
    const id = activePendingId || `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    setPendingStories((items) => {
      const existing = items.find((item) => item.id === id);
      const nextItem: StoryPendingItem = { id, draft: sourceDraft, brief: sourceBrief, briefAnswers: answers, plan: nextPlan, characterNames: names, characterDetails: details, createdAt: existing?.createdAt || now, updatedAt: now };
      return [nextItem, ...items.filter((item) => item.id !== id)].slice(0, 24);
    });
    setActivePendingId(id);
  };

  const preparePlan = async (answers = briefAnswers, names = characterNames, details = characterDetails, sourceBrief = brief) => {
    const context = makeContext(answers, names, details, sourceBrief);
    if (!context || !sourceBrief) return;
    const firstMissingAnswer = sourceBrief?.questions.findIndex((question) => !answers[question.id]?.trim()) ?? -1;
    if (firstMissingAnswer >= 0) {
      setBriefQuestionIndex(firstMissingAnswer);
      setBriefValidationError('برای ساخت طرح اولیه، این انتخاب را هم ثبت کن.');
      setBriefDialogOpen(true);
      return;
    }
    setIsPreparingPlan(true);
    setWaitingMode('preview');
    setWaitingDialogOpen(true);
    const controller = new AbortController();
    waitingRequestRef.current = controller;
    setBriefError('');
    setBriefValidationError('');
    try {
      const nextPlan = await prepareStoryPreview({ ...draft, idea: draft.idea.trim() }, context, controller.signal);
      if (controller.signal.aborted) return;
      const nextCharacterNames = names.length ? names : nextPlan.characters.map((character) => character.name);
      setPlan(nextPlan);
      setCharacterNames(nextCharacterNames);
      savePendingStory(nextPlan, answers, nextCharacterNames, details, sourceBrief, { ...draft, idea: draft.idea.trim() });
      setFlow('preview');
    } catch (error) {
      if (controller.signal.aborted) return;
      setBriefError(error instanceof Error ? error.message : 'نتوانستم طرح اولیه را آماده کنم.');
      setBriefDialogOpen(true);
    } finally {
      if (waitingRequestRef.current === controller) {
        waitingRequestRef.current = null;
        setIsPreparingPlan(false);
        setWaitingDialogOpen(false);
      }
    }
  };

  const startIdeaOptimization = async () => {
    const context = makeContext();
    if (!brief || !context) return;
    setIsOptimizingIdea(false);
    setIsPreparingBrief(true);
    setBriefError('');
    setBriefValidationError('');
    setBriefDialogOpen(false);
    setWaitingMode('optimization');
    setWaitingDialogOpen(true);
    const controller = new AbortController();
    waitingRequestRef.current = controller;
    try {
      const followUp = await clarifyStoryBrief({ ...draft, idea: draft.idea.trim() }, context, controller.signal);
      if (controller.signal.aborted) return;
      const nextBrief: StoryBrief = {
        ...brief,
        summary: followUp.summary,
        resolvedDetails: followUp.resolvedDetails,
        assumptions: followUp.assumptions,
        questions: followUp.status === 'needs_clarification'
          ? [...brief.questions, ...followUp.questions.map((question, index) => ({ ...question, id: `${question.id}-${brief.questions.length + index + 1}` }))]
          : brief.questions
      };
      setBrief(nextBrief);
      if (followUp.status === 'needs_clarification' && followUp.questions.length) {
        setBriefQuestionIndex(brief.questions.length);
        setIsOptimizingIdea(true);
        setBriefDialogOpen(true);
      } else {
        await preparePlan(briefAnswers, characterNames, characterDetails, nextBrief);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setBriefError(error instanceof Error ? error.message : 'نتوانستم جزئیات لازم داستان را بررسی کنم.');
      setBriefDialogOpen(true);
    } finally {
      setIsPreparingBrief(false);
      if (waitingRequestRef.current === controller) {
        waitingRequestRef.current = null;
        setWaitingDialogOpen(false);
      }
    }
  };

  const cancelWaiting = () => {
    waitingRequestRef.current?.abort();
    waitingRequestRef.current = null;
    setIsPreparingPlan(false);
    setIsPreparingBrief(false);
    setWaitingDialogOpen(false);
  };

  const runScenarioGeneration = async () => {
    const context = makeContext();
    if (!context) return;
    const duration = getDurationSeconds(briefAnswers.duration || '');
    const durationLength: StoryDraft['length'] = duration <= 30 ? 'short' : duration <= 60 ? 'medium' : 'long';
    const storyDraft = {
      ...draft,
      idea: draft.idea.trim(),
      length: durationLength
    };
    setScenarioDialogOpen(true);
    setScenarioError('');
    setScenario('');
    setIsGenerating(true);
    try {
      const result = await generateStoryScenario(storyDraft, context);
      setScenario(result.scenario);
      setScenarioStory(result.story);
      const storyId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const initialVersion: StoryVersion = { id: `${storyId}-v1`, createdAt: new Date().toISOString(), label: 'نسخه‌ی اول', scenario: result.scenario, story: result.story };
      setActiveStoryId(storyId);
      setStoryHistory((items) => [{ id: storyId, title: getStoryTitle(result.scenario, characterNames[0] || ''), idea: storyDraft.idea, scenario: result.scenario, scenes: result.scenes, createdAt: initialVersion.createdAt, story: result.story, versions: [initialVersion] }, ...items].slice(0, 24));
      if (activePendingId) {
        setPendingStories((items) => items.filter((item) => item.id !== activePendingId));
        setActivePendingId(null);
      }
    } catch (error) {
      setScenarioError(error instanceof Error ? error.message : 'سناریو ساخته نشد. لطفاً دوباره امتحان کن.');
    } finally { setIsGenerating(false); }
  };

  const startBrief = async () => {
    setBriefDialogOpen(true);
    setBriefError('');
    setBriefValidationError('');
    setBrief(null);
    setBriefAnswers({});
    setBriefQuestionIndex(0);
    setEditingQuestionId(null);
    setCustomAnswerOpen(false);
    setCustomAnswer('');
    setIsPreparingBrief(true);
    try {
      const nextBrief = await prepareStoryBrief({ ...draft, idea: draft.idea.trim() });
      if (nextBrief.questions.length !== 5) throw new Error('سؤال‌های لازم کامل آماده نشدند. لطفاً دوباره امتحان کن.');
      setBrief(nextBrief);
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : 'نتوانستم ایده را بررسی کنم.');
    } finally { setIsPreparingBrief(false); }
  };

  const applyAnswer = (answer: string) => {
    if (!brief || !activeBriefQuestion || !answer.trim()) return;
    const nextAnswers = { ...briefAnswers, [activeBriefQuestion.id]: answer.trim() };
    setBriefAnswers(nextAnswers);
    setBriefValidationError('');
    setCustomAnswerOpen(false);
    setCustomAnswer('');
    if (editingQuestionId) {
      setEditingQuestionId(null);
      setBriefDialogOpen(false);
      void preparePlan(nextAnswers);
      return;
    }
    if (briefQuestionIndex === brief.questions.length - 1) {
      setBriefDialogOpen(false);
      setIsOptimizingIdea(false);
      void preparePlan(nextAnswers);
      return;
    }
    setBriefQuestionIndex((index) => index + 1);
  };

  const startAnswerEdit = (questionId: string) => {
    const index = brief?.questions.findIndex((question) => question.id === questionId) ?? -1;
    if (index < 0) return;
    setAnswerPickerOpen(false);
    setBriefQuestionIndex(index);
    setEditingQuestionId(questionId);
    setCustomAnswerOpen(false);
    setCustomAnswer('');
    setBriefDialogOpen(true);
  };

  const openCharacterEditor = () => {
    const savedDetails = new Map(characterDetails.map((character) => [character.name, character]));
    const names = characterNames.length ? characterNames : plan?.characters.map((character) => character.name) || [];
    setCharacterNameDraft(names.map((name) => ({ name, role: savedDetails.get(name)?.role || '', purpose: savedDetails.get(name)?.purpose || '', isNew: savedDetails.has(name) })));
    setCharacterError('');
    setCharacterEditorOpen(true);
  };

  const saveCharacterNames = () => {
    const characters = characterNameDraft.map((character) => ({ ...character, name: character.name.trim(), role: character.role.trim(), purpose: character.purpose.trim() })).filter((character) => character.name).filter((character, index, items) => items.findIndex((item) => item.name === character.name) === index).slice(0, 8);
    const names = characters.map((character) => character.name);
    if (!names.length) { setCharacterError('حداقل یک شخصیت برای داستان نگه دار.'); return; }
    if (characters.some((character) => character.isNew && (!character.role || !character.purpose))) { setCharacterError('برای شخصیت تازه، نقش او و دلیل حضورش در داستان را هم بنویس.'); return; }
    const details = characters.filter((character) => character.isNew).map(({ name, role, purpose }) => ({ name, role, purpose }));
    setCharacterNames(names);
    setCharacterDetails(details);
    setCharacterEditorOpen(false);
    void preparePlan(briefAnswers, names, details);
  };

  const prepareScenario = (event: FormEvent) => {
    event.preventDefault();
    setIdeaTouched(true);
    if (draft.idea.trim()) void startBrief();
  };

  const copyScenario = async () => {
    try { await navigator.clipboard.writeText(scenario); notify.success('سناریو کپی شد!'); } catch { notify.error('کپی نشد؛ دوباره امتحان کن.'); }
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'Home' || event.key === 'ArrowRight' ? 'create' : event.key === 'End' || event.key === 'ArrowLeft' ? 'history' : null;
    if (!next) return;
    event.preventDefault();
    setActiveTab(next);
    window.requestAnimationFrame(() => document.getElementById(`story-${next}-tab`)?.focus());
  };

  const openHistoryStory = (item: StoryHistoryItem) => {
    setScenarioError(''); setIsGenerating(false); setScenario(item.scenario); setScenarioStory(item.story || null); setActiveStoryId(item.id); setScenarioDialogOpen(true);
  };

  const resumePendingStory = (item: StoryPendingItem) => {
    setDraft(item.draft);
    setBrief(item.brief);
    setBriefAnswers(item.briefAnswers);
    setBriefQuestionIndex(0);
    setPlan(item.plan);
    setCharacterNames(item.characterNames);
    setCharacterDetails(item.characterDetails || []);
    setActivePendingId(item.id);
    setBriefDialogOpen(false);
    setAnswerPickerOpen(false);
    setCharacterEditorOpen(false);
    setBriefError('');
    setActiveTab('create');
    setFlow('preview');
    window.requestAnimationFrame(() => document.getElementById('story-create-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const saveEditedStory = ({ story, scenario: nextScenario, label }: { story: StoryScenario; scenario: string; label: string }) => {
    if (!activeStoryId) return;
    const version: StoryVersion = { id: `${activeStoryId}-${Date.now()}`, createdAt: new Date().toISOString(), label, scenario: nextScenario, story };
    setScenario(nextScenario); setScenarioStory(story);
    setStoryHistory((items) => items.map((item) => item.id === activeStoryId ? { ...item, title: story.title || item.title, scenario: nextScenario, story, versions: [...(item.versions || []), version].slice(-12) } : item));
    notify.success('نسخه‌ی تازه‌ی سناریو ذخیره شد.');
  };

  const restoreStoryVersion = (version: StoryVersion) => {
    if (!activeStoryId) return;
    setScenario(version.scenario); setScenarioStory(version.story);
    setStoryHistory((items) => items.map((item) => item.id === activeStoryId ? { ...item, title: version.story.title || item.title, scenario: version.scenario, story: version.story } : item));
    notify.success('این نسخه دوباره فعال شد.');
  };

  const activeVersions = storyHistory.find((item) => item.id === activeStoryId)?.versions || [];
  const savedStoryCount = storyHistory.length + pendingStories.length;

  return (
    <main className="story-maker" dir="rtl" id="main-content">
      <header className="story-maker__header">
        <button type="button" className="story-maker__back" onClick={onBack} aria-label="بازگشت به استودیو" title="بازگشت به استودیو"><Icon name="chevron-right" size={22} aria-hidden="true" /></button>
        <div className="story-maker__brand"><span className="story-maker__brand-mark" aria-hidden="true"><Icon name="story" size={22} /></span><span><strong>سناریو نویسی ( داستان من )</strong><small>ایده‌ات را به یک سناریوی حرفه‌ای تبدیل کن</small></span></div>
        <span aria-hidden="true" />
      </header>

      <nav className="story-maker__tabs" role="tablist" aria-label="بخش‌های داستان‌نویسی">
        <button id="story-create-tab" type="button" role="tab" aria-selected={activeTab === 'create'} aria-controls="story-create-panel" tabIndex={activeTab === 'create' ? 0 : -1} className={activeTab === 'create' ? 'is-active' : ''} onClick={() => setActiveTab('create')} onKeyDown={handleTabKey}><Icon name="story" size={18} aria-hidden="true" /> ساخت سناریو</button>
        <button id="story-history-tab" type="button" role="tab" aria-selected={activeTab === 'history'} aria-controls="story-history-panel" tabIndex={activeTab === 'history' ? 0 : -1} className={activeTab === 'history' ? 'is-active' : ''} onClick={() => setActiveTab('history')} onKeyDown={handleTabKey}><Icon name="book" size={18} aria-hidden="true" /> داستان‌های من {savedStoryCount ? <span>{savedStoryCount}</span> : null}</button>
      </nav>

      {activeTab === 'create' ? <div className="story-maker__shell" id="story-create-panel" role="tabpanel" aria-labelledby="story-create-tab">
        {flow === 'idea' ? <section className="story-maker__idea-stage" aria-labelledby="story-maker-title">
          <div className="story-maker__idea-overview">
            <span className="story-maker__eyebrow"><Icon name="sparkle" size={15} aria-hidden="true" /> شروعِ قصه</span>
            <h1 id="story-maker-title">درمورد چی میخوای داستان بسازی ؟</h1>
            <p>ایده‌ات را بنویس؛ بعد قدم‌به‌قدم جزئیاتش را کامل می‌کنیم تا سناریویی دقیق و مخصوص خودت بسازیم.</p>
            <ol className="story-maker__idea-steps" aria-label="مسیر ساخت سناریو">
              <li><span>۱</span><div><strong>ایده را بنویس</strong><small>حتی یک جمله کوتاه کافی است.</small></div></li>
              <li><span>۲</span><div><strong>جزئیات را مشخص کن</strong><small>فقط سؤال‌های لازم را می‌پرسیم.</small></div></li>
              <li><span>۳</span><div><strong>طرح را تأیید کن</strong><small>بعد سناریوی نهایی را می‌سازیم.</small></div></li>
            </ol>
          </div>
          <form className="story-maker__idea-form" onSubmit={prepareScenario} noValidate>
            <div className="story-maker__idea-form-heading"><span className="story-maker__idea-form-icon"><Icon name="edit" size={19} aria-hidden="true" /></span><div><strong>جرقه‌ی داستانت را اینجا بنویس</strong><small>هرچقدر ساده یا کامل، نقطه‌ی شروع ماست.</small></div></div>
            <label className="story-maker__field" htmlFor="story-idea"><span>داستان من درباره‌ی…</span><textarea id="story-idea" value={draft.idea} onChange={(event) => setDraft((current) => ({ ...current, idea: event.target.value.slice(0, 240) }))} onBlur={() => setIdeaTouched(true)} aria-invalid={Boolean(ideaError)} aria-describedby={ideaError ? 'story-idea-error' : 'story-idea-help'} placeholder="مثلاً یک گربه‌ی فضایی که دنبال سیاره‌ی بستنی‌ها می‌گردد" maxLength={240} /></label>
            <div className="story-maker__field-meta"><span id="story-idea-help">لازم نیست کاملش کنی؛ در مرحله‌ی بعد با هم کاملش می‌کنیم.</span><span>{draft.idea.length}/۲۴۰</span></div>
            {ideaError ? <p id="story-idea-error" className="story-maker__error" role="alert">{ideaError}</p> : null}
            <div className="story-maker__submit"><Button type="submit" size="lg" loading={isPreparingBrief} className="story-maker__submit-button" endIcon={<Icon name="sparkle" size={19} />}>{isPreparingBrief ? 'داریم پیشنهادهای مناسب را آماده می‌کنیم…' : 'ثبت ایده و ادامه'}</Button></div>
          </form>
        </section> : <section className="story-maker__plan-stage" aria-labelledby="story-plan-title">
          {isPreparingPlan ? <div className="story-maker__dialog-loading story-maker__plan-loading" role="status" aria-live="polite"><Icon name="spinner" size={32} aria-hidden="true" /><strong>داریم طرح اولیه‌ی قصه را می‌چینیم…</strong><span>شخصیت‌ها، دنیای داستان و مسیر کلی را با انتخاب‌هایت هماهنگ می‌کنیم.</span><div className="story-maker__plan-progress" role="progressbar" aria-label="در حال آماده‌سازی طرح اولیه" aria-valuetext="در حال آماده‌سازی طرح اولیه"><i /></div><small>سناریوی نهایی هنوز ساخته نمی‌شود.</small></div> : plan ? <>
            <div className="story-maker__plan-heading"><span className="story-maker__eyebrow"><Icon name="sparkle" size={15} aria-hidden="true" /> داستان کلی</span><h1 id="story-plan-title">{plan.title}</h1><p>{plan.overview}</p></div>
            <section className="story-maker__world-section" aria-labelledby="story-world-title"><h2 id="story-world-title">دنیای داستان</h2><article className="story-maker__world-card"><p>{plan.world}</p><span>{plan.format} <i>·</i> {plan.duration} <i>·</i> {plan.tone}</span></article></section>
            <div className="story-maker__plan-grid">
              <article className="story-maker__plan-card"><span>شخصیت‌ها</span><div className="story-maker__character-list">{plan.characters.map((character) => <div key={`${character.name}-${character.role}`}><strong>{character.name}</strong><small>{character.role}</small><p>{character.description}</p></div>)}</div></article>
              <article className="story-maker__plan-card"><span>مسیر کلی قصه</span><dl><div><dt>شروع</dt><dd>{plan.storyPath.beginning}</dd></div><div><dt>چالش</dt><dd>{plan.storyPath.challenge}</dd></div><div><dt>اوج</dt><dd>{plan.storyPath.climax}</dd></div><div><dt>فرجام</dt><dd>{plan.storyPath.resolution}</dd></div></dl></article>
            </div>
            <p className="story-maker__plan-note"><Icon name="lightbulb" size={18} aria-hidden="true" /> این پنج انتخاب، مبنای ساخت سناریوی نهایی هستند؛ فعلاً فقط نقشه‌ی راه را می‌بینی و صحنه‌ها و دیالوگ‌ها هنوز ساخته نشده‌اند.</p>
            <article className="story-maker__plan-card story-maker__plan-card--choices"><span>انتخاب‌های تو</span><div className="story-maker__answer-summary">{brief?.questions.map((question) => <div key={question.id}><small>{question.question}</small><strong>{briefAnswers[question.id] || 'به انتخاب دانوآ'}</strong></div>)}</div><div className="story-maker__plan-actions"><div className="story-maker__plan-edits"><Button type="button" variant="secondary" onClick={openCharacterEditor} startIcon={<Icon name="edit" size={17} aria-hidden="true" />}>ویرایش نام شخصیت‌ها</Button><Button type="button" variant="secondary" onClick={() => setAnswerPickerOpen(true)} startIcon={<Icon name="edit" size={17} aria-hidden="true" />}>ویرایش جزئیات</Button><Button type="button" variant="secondary" loading={isPreparingBrief} onClick={() => void startIdeaOptimization()} startIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>بهینه‌سازی ایده</Button></div><Button type="button" size="lg" loading={isGenerating} onClick={() => void runScenarioGeneration()} endIcon={<Icon name="sparkle" size={19} aria-hidden="true" />}>اوکیه، سناریو رو بساز</Button></div></article>
          </> : null}
        </section>}
      </div> : <section className="story-maker__history" id="story-history-panel" role="tabpanel" aria-labelledby="story-history-tab">
        <div className="story-maker__history-heading"><div><span className="story-maker__eyebrow"><Icon name="book" size={15} aria-hidden="true" /> کتابخانه‌ی من</span><h1>داستان‌های من</h1><p>سناریوهای نهایی و طرح‌هایی که هنوز منتظر تأیید تو هستند.</p></div><span className="story-maker__history-count">{savedStoryCount} مورد</span></div>
        {pendingStories.length ? <section className="story-maker__history-section" aria-labelledby="pending-stories-title"><div className="story-maker__history-section-heading"><div><span className="story-maker__pending-label"><Icon name="sparkle" size={14} aria-hidden="true" /> در انتظار تأیید</span><h2 id="pending-stories-title">طرح‌های نیمه‌کاره</h2></div><small>از همین‌جا ادامه بده</small></div><div className="story-maker__history-grid">{pendingStories.map((item) => <button key={item.id} type="button" className="story-maker__history-card story-maker__history-card--pending" onClick={() => resumePendingStory(item)} aria-label={`ادامه‌ی طرح ${item.plan.title}`}><span className="story-maker__history-card-icon"><Icon name="sparkle" size={22} aria-hidden="true" /></span><span className="story-maker__history-card-body"><strong>{item.plan.title}</strong><span className="story-maker__history-idea">{item.draft.idea}</span><span className="story-maker__history-meta"><span>طرح اولیه آماده است</span><span>{formatStoryDate(item.updatedAt)}</span></span></span><span className="story-maker__continue-label">ادامه</span><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}</div></section> : null}
        {storyHistory.length ? <section className="story-maker__history-section" aria-labelledby="finished-stories-title"><div className="story-maker__history-section-heading"><div><span className="story-maker__history-label">سناریوهای نهایی</span><h2 id="finished-stories-title">داستان‌های کامل‌شده</h2></div></div><div className="story-maker__history-grid">{storyHistory.map((item) => <button key={item.id} type="button" className="story-maker__history-card" onClick={() => openHistoryStory(item)} aria-label={`باز کردن ${item.title}`}><span className="story-maker__history-card-icon"><Icon name="story" size={22} aria-hidden="true" /></span><span className="story-maker__history-card-body"><strong>{item.title}</strong><span className="story-maker__history-idea">{item.idea}</span><span className="story-maker__history-meta"><span>{item.scenes} صحنه</span><span>{formatStoryDate(item.createdAt)}</span></span></span><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}</div></section> : null}
        {!savedStoryCount ? <div className="story-maker__history-empty"><span><Icon name="book" size={32} aria-hidden="true" /></span><h2>کتاب داستانت هنوز خالیه</h2><p>اولین داستانت را بساز؛ بعد همیشه همین‌جا پیدایش می‌کنی.</p><Button type="button" onClick={() => { setActiveTab('create'); setFlow('idea'); }} startIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>ساخت داستان تازه</Button></div> : null}
      </section>}

      <Dialog open={briefDialogOpen} title={isPreparingBrief ? 'داریم جزئیات لازم قصه را بررسی می‌کنیم…' : briefError ? 'یک مشکل کوچولو پیش آمد' : editingQuestionId ? 'ویرایش یک انتخاب' : isOptimizingIdea ? 'بهینه‌سازی اختیاری ایده' : 'انتخاب‌های مهم قصه'} onClose={() => setBriefDialogOpen(false)} showFooter={false} panelClassName="story-maker__brief-dialog">
        {isPreparingBrief ? <div className="story-maker__dialog-loading" role="status" aria-live="polite"><Icon name="spinner" size={30} aria-hidden="true" /><strong>داریم بررسی می‌کنیم آیا جزئیات مهم دیگری لازم است یا نه…</strong><span>فقط اگر برای سناریوی دقیق لازم باشد، سؤال بعدی می‌پرسیم.</span></div> : null}
        {briefError ? <div className="story-maker__dialog-error" role="alert"><Icon name="alert-triangle" size={22} aria-hidden="true" /><p>{briefError}</p><div className="story-maker__brief-actions"><Button type="button" variant="secondary" onClick={() => setBriefDialogOpen(false)}>بستن</Button><Button type="button" onClick={() => void startBrief()}>دوباره تلاش کن</Button></div></div> : null}
        {brief && activeBriefQuestion && !briefError ? (
          <div className="story-maker__brief-content">
            <div className="story-maker__brief-intro"><span className="story-maker__brief-sparkle"><Icon name="sparkle" size={18} aria-hidden="true" /></span><div><strong>{editingQuestionId ? 'همین بخش را تغییر بده' : 'قصه‌ات دارد شکل می‌گیرد!'}</strong><p>{brief.summary}</p></div></div>
            <div className="story-maker__brief-progress" aria-label={`سؤال ${briefQuestionIndex + 1} از ${brief.questions.length}`}><span>سؤال {briefQuestionIndex + 1} از {brief.questions.length}</span><div aria-hidden="true">{brief.questions.map((question, index) => <i key={question.id} className={index <= briefQuestionIndex ? 'is-active' : ''} />)}</div></div>
            <section key={activeBriefQuestion.id} className="story-maker__brief-question story-maker__brief-question--active" aria-labelledby={`brief-question-${activeBriefQuestion.id}`} aria-live="polite">
              <span>{briefQuestionIndex + 1}</span>
              <div>
                <h3 id={`brief-question-${activeBriefQuestion.id}`}>{activeBriefQuestion.question}</h3>
                {activeBriefQuestion.hint ? <p>{activeBriefQuestion.hint}</p> : null}
                {isDurationQuestion ? (
                  <form className="story-maker__duration-input" onSubmit={(event) => { event.preventDefault(); applyAnswer(`${new Intl.NumberFormat('fa-IR').format(durationSeconds)} ثانیه`); }}>
                    <div className="story-maker__duration-value"><output htmlFor="story-duration-range story-duration-number">{new Intl.NumberFormat('fa-IR').format(durationSeconds)}</output><span>ثانیه</span></div>
                    <input id="story-duration-range" type="range" min="2" max="60" step="1" value={durationSeconds} onChange={(event) => setDurationSeconds(clampDuration(Number(event.target.value)))} aria-label="انتخاب مدت داستان بر حسب ثانیه" />
                    <label className="story-maker__duration-number" htmlFor="story-duration-number"><span>یا دقیق تایپ کن</span><input id="story-duration-number" type="number" min="2" max="60" inputMode="numeric" value={durationSeconds} onChange={(event) => setDurationSeconds(clampDuration(Number(event.target.value)))} /><small>ثانیه</small></label>
                    <Button type="submit" size="sm">ثبت و ادامه</Button>
                  </form>
                ) : (
                  <>
                    <div className="story-maker__brief-options" role="radiogroup" aria-label={activeBriefQuestion.question}>{activeBriefQuestion.options.map((option) => <button key={option} type="button" role="radio" aria-checked={briefAnswers[activeBriefQuestion.id] === option} className={briefAnswers[activeBriefQuestion.id] === option ? 'is-selected' : ''} onClick={() => applyAnswer(option)}>{option}{briefAnswers[activeBriefQuestion.id] === option ? <OptionCheck /> : null}</button>)}<button type="button" className={customAnswerOpen ? 'is-selected' : ''} onClick={() => { setCustomAnswerOpen(true); setCustomAnswer(briefAnswers[activeBriefQuestion.id] || ''); }}>خودم می‌نویسم</button></div>
                    {customAnswerOpen ? <form className="story-maker__custom-answer" onSubmit={(event) => { event.preventDefault(); applyAnswer(customAnswer); }}><input value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value.slice(0, 100))} placeholder="انتخاب خودت را بنویس" autoFocus maxLength={100} /><Button type="submit" size="sm">ثبت انتخاب</Button></form> : null}
                  </>
                )}
                {briefValidationError ? <p className="story-maker__error" role="alert">{briefValidationError}</p> : null}
              </div>
            </section>
            <div className="story-maker__brief-actions">{!editingQuestionId && briefQuestionIndex ? <Button type="button" variant="secondary" onClick={() => setBriefQuestionIndex((index) => Math.max(0, index - 1))}>سؤال قبلی</Button> : <Button type="button" variant="secondary" onClick={() => setBriefDialogOpen(false)}>فعلاً بعداً</Button>}<span className="story-maker__brief-next-hint">{isDurationQuestion ? 'مدت دلخواهت را ثبت کن تا ادامه بدهیم.' : 'یک گزینه انتخاب کن تا ادامه بدهیم.'}</span></div>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={waitingDialogOpen} title={waitingMode === 'preview' ? 'داریم طرح اولیه‌ی قصه را می‌چینیم' : 'داریم ایده‌ات را بهینه می‌کنیم'} onClose={cancelWaiting} closeLabel="انصراف از آماده‌سازی" showFooter={false} panelClassName="story-maker__wait-dialog">
        <div className="story-maker__wait-content" role="status" aria-live="polite">
          <div className="story-maker__wait-orbit" aria-hidden="true"><span><Icon name="sparkle" size={25} /></span><i /><b /></div>
          <div className="story-maker__wait-copy"><strong>{waitingMode === 'preview' ? 'جواب‌هایت را کنار هم گذاشتیم' : 'داریم ایده‌ات را از زاویه‌های مهم بررسی می‌کنیم'}</strong><p>{waitingMode === 'preview' ? 'دانوآ بر اساس پنج انتخابت، دنیای داستان و شخصیت‌ها را برای تأیید آماده می‌کند.' : 'فقط اگر نکته‌ای واقعاً روی سناریو اثر داشته باشد، چند سؤال کوتاه و هدفمند می‌پرسیم.'}</p></div>
          <div className="story-maker__wait-progress" aria-hidden="true"><i /></div>
          <div className="story-maker__wait-status"><span><Icon name="check" size={15} aria-hidden="true" /> انتخاب‌های اصلی ثبت شد</span><span><Icon name="spinner" size={15} aria-hidden="true" /> {waitingMode === 'preview' ? 'آماده‌سازی خلاصه‌ی طرح' : 'بررسی شفاف‌بودن ایده'}</span></div>
        </div>
      </Dialog>

      <Dialog open={answerPickerOpen} title="کدام جزئیات را می‌خواهی تغییر بدهی؟" onClose={() => setAnswerPickerOpen(false)} showFooter={false} panelClassName="story-maker__brief-dialog">
        <div className="story-maker__answer-picker">{brief?.questions.map((question, index) => <button key={question.id} type="button" onClick={() => startAnswerEdit(question.id)}><span>{index + 1}</span><div><strong>{question.question}</strong><small>{briefAnswers[question.id]}</small></div><Icon name="chevron-left" size={18} aria-hidden="true" /></button>)}</div>
      </Dialog>

      <Dialog open={characterEditorOpen} title="شخصیت‌ها را ویرایش کن" onClose={() => setCharacterEditorOpen(false)} showFooter={false} panelClassName="story-maker__brief-dialog">
        <div className="story-maker__character-editor">
          <p>نام‌ها را تغییر بده. برای شخصیت تازه، نقش او و دلیل ورودش به داستان را هم شفاف کن تا در طرح و سناریو استفاده شود.</p>
          {characterNameDraft.map((character, index) => <div key={`character-${index}`} className={`story-maker__character-entry${character.isNew ? ' story-maker__character-entry--new' : ''}`}>
            <div className="story-maker__character-row">
              <strong>{character.isNew ? 'شخصیت تازه' : plan?.characters[index]?.name || 'شخصیت'}</strong>
              <Icon name="chevron-left" size={18} aria-hidden="true" />
              <input value={character.name} onChange={(event) => setCharacterNameDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value.slice(0, 40) } : item))} placeholder="نام شخصیت" maxLength={40} aria-label={`نام ${character.isNew ? 'شخصیت تازه' : 'شخصیت'}`} />
              <button type="button" onClick={() => setCharacterNameDraft((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`حذف ${character.name || 'شخصیت'}`}>×</button>
            </div>
            {character.isNew ? <div className="story-maker__new-character-fields">
              <label><span>نقش او در قصه چیست؟</span><input value={character.role} onChange={(event) => setCharacterNameDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value.slice(0, 80) } : item))} placeholder="مثلاً دوستِ کنجکاو قهرمان" maxLength={80} /></label>
              <label><span>چرا وارد داستان می‌شود؟</span><input value={character.purpose} onChange={(event) => setCharacterNameDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, purpose: event.target.value.slice(0, 140) } : item))} placeholder="مثلاً کمک می‌کند راز مهمانی را پیدا کنند" maxLength={140} /></label>
            </div> : null}
          </div>)}
          {characterError ? <p className="story-maker__error" role="alert">{characterError}</p> : null}
          <div className="story-maker__brief-actions"><Button type="button" variant="secondary" onClick={() => setCharacterNameDraft((items) => [...items, { name: '', role: '', purpose: '', isNew: true }])}>+ افزودن شخصیت</Button><Button type="button" onClick={saveCharacterNames}>ثبت شخصیت‌ها</Button></div>
        </div>
      </Dialog>

      <Dialog open={scenarioDialogOpen} title={isGenerating ? 'دانوآ دارد سناریو را می‌سازد…' : scenarioError ? 'دوباره امتحان کنیم؟' : 'سناریوی تو آماده شد!'} onClose={() => setScenarioDialogOpen(false)} showFooter={false} panelClassName="story-maker__dialog">
        {isGenerating ? <div className="story-maker__dialog-loading" role="status" aria-live="polite"><Icon name="spinner" size={30} aria-hidden="true" /><strong>داریم صحنه‌ها و دیالوگ‌ها را می‌چینیم…</strong><span>یک کوچولو صبر کن.</span></div> : null}
        {scenarioError ? <div className="story-maker__dialog-error" role="alert"><Icon name="alert-triangle" size={22} aria-hidden="true" /><p>{scenarioError}</p><Button type="button" onClick={() => void runScenarioGeneration()}>دوباره بساز</Button></div> : null}
        {scenario ? <><article className="story-maker__scenario" aria-label="سناریوی نهایی"><ReactMarkdown remarkPlugins={[remarkGfm]}>{scenario}</ReactMarkdown></article><div className="story-maker__dialog-actions"><Button type="button" variant="secondary" onClick={() => setScenarioDialogOpen(false)}>بستن</Button>{scenarioStory ? <Button type="button" variant="secondary" onClick={() => { setScenarioDialogOpen(false); setEditorOpen(true); }} startIcon={<Icon name="edit" size={18} aria-hidden="true" />}>ویرایش سناریو</Button> : null}<Button type="button" onClick={() => void copyScenario()} startIcon={<Icon name="copy" size={18} aria-hidden="true" />}>کپی سناریو</Button></div></> : null}
      </Dialog>
      <StoryEditorDialog open={editorOpen} story={scenarioStory} expectedScenes={scenarioStory?.scenes.length || 0} versions={activeVersions} onClose={() => setEditorOpen(false)} onSaved={saveEditedStory} onRestore={restoreStoryVersion} />
    </main>
  );
}
