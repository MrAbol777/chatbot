import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Dialog, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import { clarifyStoryBrief, createStoryWorkspace, generateStoryScenario, getStoryWorkspace, listStoryWorkspaces, prepareStoryBrief, prepareStoryPreview, updateStoryWorkspace } from './storyMaker.api';
import StoryEditorDialog from './StoryEditorDialog';
import StoryWormGame from './StoryWormGame';
import type { StoryAddedCharacter, StoryBrief, StoryContext, StoryDraft, StoryPlanPreview, StoryScenario, StoryVersion, StoryWorkspace, StoryWorkspaceStatus } from './storyMaker.types';
import './StoryMakerPage.css';

type Props = { onBack: () => void; workspaceId?: string; onOpenWorkspace?: (id: string, mode?: 'push' | 'replace') => void; onOpenCharacterMaker?: (scenario: string, title?: string) => void };
type StoryTab = 'create' | 'history';
type StoryFlow = 'idea' | 'preview';
type WaitingMode = 'preview' | 'optimization';
type OptimizationPhase = 'checking' | 'updating' | 'complete';
type StoryHistoryItem = { id: string; title: string; idea: string; scenario: string; scenes: number; createdAt: string; story?: StoryScenario; versions?: StoryVersion[]; workspaceId?: string };
type StoryPendingItem = { id: string; draft: StoryDraft; brief: StoryBrief; briefAnswers: Record<string, string>; plan: StoryPlanPreview; characterNames: string[]; characterDetails?: StoryAddedCharacter[]; createdAt: string; updatedAt: string };
type CharacterEditorItem = StoryAddedCharacter & { isNew: boolean };
const STORY_HISTORY_STORAGE_KEY = 'danoa-story-history-v1';
const STORY_PENDING_STORAGE_KEY = 'danoa-story-pending-v1';
const initialDraft: StoryDraft = { idea: '', heroName: '', companionName: '', mood: 'adventure', place: 'forest', customPlace: '', length: 'medium', customSceneCount: '', ending: 'happy', customEnding: '' };
const storyDetailLabels: Record<string, string> = { age: 'گروه سنی', format: 'قالب داستان', duration: 'مدت داستان', location: 'محل رخداد', mood: 'حال‌وهوای داستان' };
const durationPresetOptions = [5, 10, 15] as const;

function discardLegacyFollowUpQuestions(source: StoryBrief | null | undefined): StoryBrief | null {
  if (!source) return null;
  const baseQuestions = source.questions.slice(0, 5);
  const validFollowUps = source.questions.slice(5).filter((question) => question.options.length >= 2).slice(0, 2);
  return { ...source, questions: [...baseQuestions, ...validFollowUps] };
}

function OptionCheck() {
  return <span className="story-maker__option-check" aria-hidden="true"><Icon name="check" size={14} /></span>;
}

type StoryProcessingStage = 0 | 1 | 2;

const storyProcessingSteps = ['ایده', 'جزئیات', 'داستان'] as const;

function StoryProcessingCard({ stage, headline, support, onCancel }: { stage: StoryProcessingStage; headline: string; support: string; onCancel: () => void }) {
  return (
    <div className="story-maker__processing-card" role="status" aria-live="polite" aria-busy="true">
      <div className="story-maker__processing-orbit" aria-hidden="true">
        <span><Icon name="sparkle" size={25} /></span>
        <i />
        <b />
      </div>
      <ol className="story-maker__processing-steps" aria-label="مراحل آماده‌سازی داستان">
        {storyProcessingSteps.map((label, index) => (
          <li key={label} className={index === stage ? 'is-current' : index < stage ? 'is-complete' : ''} aria-current={index === stage ? 'step' : undefined}>
            <span aria-hidden="true">{index < stage ? <Icon name="check" size={13} /> : index + 1}</span>
            <small>{label}</small>
          </li>
        ))}
      </ol>
      <div className="story-maker__processing-copy">
        <strong>{headline}</strong>
        <p>{support}</p>
      </div>
      <Button type="button" variant="secondary" className="story-maker__processing-cancel" onClick={onCancel}>برگشت</Button>
    </div>
  );
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

function getSceneCountForDuration(seconds: number) {
  if (seconds <= 8) return 2;
  if (seconds <= 15) return 3;
  if (seconds <= 30) return 4;
  if (seconds <= 45) return 6;
  return 8;
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

export default function StoryMakerPage({ onBack, workspaceId: routeWorkspaceId = '', onOpenWorkspace, onOpenCharacterMaker }: Props) {
  const [draft, setDraft] = useState<StoryDraft>(initialDraft);
  const [activeTab, setActiveTab] = useState<StoryTab>('create');
  const [flow, setFlow] = useState<StoryFlow>('idea');
  const [storyHistory, setStoryHistory] = useState<StoryHistoryItem[]>(readStoryHistory);
  const [pendingStories, setPendingStories] = useState<StoryPendingItem[]>(readPendingStories);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);
  const [, setActiveWorkspaceId] = useState(routeWorkspaceId || null);
  const activeWorkspaceIdRef = useRef<string | null>(routeWorkspaceId || null);
  const [remoteWorkspaces, setRemoteWorkspaces] = useState<StoryWorkspace[]>([]);
  const [, setWorkspaceLoading] = useState(Boolean(routeWorkspaceId));
  const [ideaTouched, setIdeaTouched] = useState(false);
  const [brief, setBrief] = useState<StoryBrief | null>(null);
  const [briefAnswers, setBriefAnswers] = useState<Record<string, string>>({});
  const [briefQuestionIndex, setBriefQuestionIndex] = useState(0);
  const [briefDialogOpen, setBriefDialogOpen] = useState(false);
  const [waitingDialogOpen, setWaitingDialogOpen] = useState(false);
  const [waitingMode, setWaitingMode] = useState<WaitingMode>('preview');
  const briefRequestRef = useRef<AbortController | null>(null);
  const waitingRequestRef = useRef<AbortController | null>(null);
  const optimizationRequestRef = useRef<AbortController | null>(null);
  const optimizationCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [optimizationDialogOpen, setOptimizationDialogOpen] = useState(false);
  const [optimizationPhase, setOptimizationPhase] = useState<OptimizationPhase>('checking');
  const [isOptimizingIdea, setIsOptimizingIdea] = useState(false);
  const [improvementDialogOpen, setImprovementDialogOpen] = useState(false);
  const [improvementFeedback, setImprovementFeedback] = useState('');
  const [improvementError, setImprovementError] = useState('');
  const [briefError, setBriefError] = useState('');
  const [briefValidationError, setBriefValidationError] = useState('');
  const [isPreparingBrief, setIsPreparingBrief] = useState(false);
  const [customAnswerOpen, setCustomAnswerOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [answerPickerOpen, setAnswerPickerOpen] = useState(false);
  const [plan, setPlan] = useState<StoryPlanPreview | null>(null);
  const [planUpdateMessage, setPlanUpdateMessage] = useState('');
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
  const scenarioRequestRef = useRef<AbortController | null>(null);
  const ideaInputRef = useRef<HTMLTextAreaElement>(null);
  const { notify } = useNotification();
  const ideaError = ideaTouched && !draft.idea.trim() ? 'اول ایده‌ی داستان را بنویس.' : '';
  const activeBriefQuestion = brief?.questions[briefQuestionIndex] || null;
  const isDurationQuestion = activeBriefQuestion?.id === 'duration';
  const selectedDuration = briefAnswers.duration ? getDurationSeconds(briefAnswers.duration) : null;
  const selectedDurationPreset = selectedDuration && durationPresetOptions.includes(selectedDuration as (typeof durationPresetOptions)[number]) ? selectedDuration : null;
  const customDurationSelected = Boolean(selectedDuration && !selectedDurationPreset);
  const allowsCustomBriefAnswer = activeBriefQuestion?.id !== 'format';
  const isImprovementQuestion = isOptimizingIdea && Boolean(activeBriefQuestion) && briefQuestionIndex >= 5;
  const improvementQuestionCount = isOptimizingIdea ? Math.max(0, (brief?.questions.length || 0) - 5) : 0;
  const improvementQuestionNumber = isImprovementQuestion ? briefQuestionIndex - 4 : 0;
  const briefDialogTitle = isPreparingBrief
    ? 'در حال آماده‌سازی ایده'
    : briefError
      ? 'یک مشکل کوچولو پیش آمد'
      : brief && activeBriefQuestion && !briefError
        ? activeBriefQuestion.question
        : editingQuestionId
          ? 'ویرایش یک انتخاب'
          : isOptimizingIdea
            ? 'برای بهتر شدن داستان'
            : 'سؤال داستان';
  const briefProgress = brief && activeBriefQuestion && !briefError ? (
    <div className="story-maker__brief-progress" role="progressbar" aria-valuemin={1} aria-valuemax={isImprovementQuestion ? improvementQuestionCount : brief.questions.length} aria-valuenow={isImprovementQuestion ? improvementQuestionNumber : briefQuestionIndex + 1} aria-valuetext={isImprovementQuestion ? `مرحله ${improvementQuestionNumber} از ${improvementQuestionCount}` : `مرحله ${briefQuestionIndex + 1} از ${brief.questions.length}`}>
      <div aria-hidden="true">{(isImprovementQuestion ? brief.questions.slice(5) : brief.questions).map((question, index) => <i key={question.id} className={isImprovementQuestion ? (index < improvementQuestionNumber ? 'is-active' : '') : index <= briefQuestionIndex ? 'is-active' : ''} />)}</div>
    </div>
  ) : null;

  useEffect(() => {
    if (routeWorkspaceId || activeTab !== 'create' || flow !== 'idea') return;
    const frame = window.requestAnimationFrame(() => ideaInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, flow, routeWorkspaceId]);

  useEffect(() => {
    try { window.localStorage.setItem(STORY_HISTORY_STORAGE_KEY, JSON.stringify(storyHistory.slice(0, 24))); } catch { /* Generation works without storage. */ }
  }, [storyHistory]);

  useEffect(() => {
    try { window.localStorage.setItem(STORY_PENDING_STORAGE_KEY, JSON.stringify(pendingStories.slice(0, 24))); } catch { /* Preview works without storage. */ }
  }, [pendingStories]);

  useEffect(() => () => {
    if (optimizationCloseTimerRef.current) clearTimeout(optimizationCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (isDurationQuestion) setDurationSeconds(getDurationSeconds(briefAnswers.duration || ''));
  }, [briefAnswers.duration, isDurationQuestion]);

  useEffect(() => {
    if (!brief || brief.questions.length <= 5) return;
    const sanitized = discardLegacyFollowUpQuestions(brief);
    if (!sanitized || sanitized.questions.length === brief.questions.length) return;
    setBrief(sanitized);
    setBriefQuestionIndex((index) => Math.min(index, Math.max(0, sanitized.questions.length - 1)));
    setIsOptimizingIdea(false);
    setBriefDialogOpen(false);
  }, [brief]);

  useEffect(() => {
    let active = true;
    void listStoryWorkspaces().then((items) => { if (active) setRemoteWorkspaces(items); }).catch(() => { /* Local history remains a fallback. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!routeWorkspaceId) { setActiveWorkspaceId(null); activeWorkspaceIdRef.current = null; setWorkspaceLoading(false); return; }
    let active = true;
    setWorkspaceLoading(true);
    void getStoryWorkspace(routeWorkspaceId).then((workspace) => {
      if (!active) return;
      setActiveWorkspaceId(workspace.id);
      activeWorkspaceIdRef.current = workspace.id;
      setDraft(workspace.draft || initialDraft);
      setBrief(discardLegacyFollowUpQuestions(workspace.brief));
      setBriefAnswers(workspace.briefAnswers || {});
      setPlan(workspace.plan || null);
      setCharacterNames(workspace.characterNames || []);
      setCharacterDetails(workspace.characterDetails || []);
      setScenario(workspace.scenario || '');
      setScenarioStory(workspace.story || null);
      setFlow(workspace.plan ? 'preview' : 'idea');
      setActiveTab('create');
      setScenarioDialogOpen(Boolean(workspace.status === 'completed' && workspace.scenario));
      if (workspace.status === 'completed' && workspace.scenario) {
        setStoryHistory((items) => items.map((item) => item.workspaceId || item.scenario !== workspace.scenario ? item : { ...item, workspaceId: workspace.id }));
      }
      setWorkspaceLoading(false);
    }).catch(() => { if (active) setWorkspaceLoading(false); });
    return () => { active = false; };
  }, [routeWorkspaceId]);

  const persistWorkspace = async (status: StoryWorkspaceStatus, patch: Partial<StoryWorkspace> = {}) => {
    const next = {
      title: patch.title || plan?.title || draft.idea.trim().slice(0, 70) || 'داستان تازه‌ی من',
      idea: patch.idea ?? draft.idea.trim(), status,
      draft: patch.draft || draft, brief: patch.brief ?? brief, briefAnswers: patch.briefAnswers || briefAnswers,
      plan: patch.plan ?? plan, characterNames: patch.characterNames || characterNames,
      characterDetails: patch.characterDetails || characterDetails, scenario: patch.scenario ?? scenario,
      story: patch.story ?? scenarioStory, versions: patch.versions || []
    };
    const workspace = activeWorkspaceIdRef.current
      ? await updateStoryWorkspace(activeWorkspaceIdRef.current, next)
      : await createStoryWorkspace(next);
    if (!activeWorkspaceIdRef.current) { setActiveWorkspaceId(workspace.id); activeWorkspaceIdRef.current = workspace.id; onOpenWorkspace?.(workspace.id, 'replace'); }
    setRemoteWorkspaces((items) => [workspace, ...items.filter((item) => item.id !== workspace.id)]);
    return workspace;
  };

  const makeContext = (answers = briefAnswers, names = characterNames, details = characterDetails, sourceBrief = brief): StoryContext | undefined => {
    if (!sourceBrief) return undefined;
    return {
      summary: sourceBrief.summary,
      resolvedDetails: sourceBrief.resolvedDetails,
      assumptions: sourceBrief.assumptions,
      answers: Object.fromEntries(sourceBrief.questions.map((question) => [storyDetailLabels[question.id] || question.question, answers[question.id] || 'به انتخاب دانوآ'])),
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

  const preparePlan = async (answers = briefAnswers, names = characterNames, details = characterDetails, sourceBrief = brief, options: { controller?: AbortController; showWaiting?: boolean } = {}) => {
    const { controller = new AbortController(), showWaiting = true } = options;
    const context = makeContext(answers, names, details, sourceBrief);
    if (!context || !sourceBrief) return false;
    const firstMissingAnswer = sourceBrief?.questions.findIndex((question) => !answers[question.id]?.trim()) ?? -1;
    if (firstMissingAnswer >= 0) {
      setBriefQuestionIndex(firstMissingAnswer);
      setBriefValidationError('برای ساخت طرح اولیه، این انتخاب را هم ثبت کن.');
      setBriefDialogOpen(true);
      return false;
    }
    setIsPreparingPlan(true);
    void persistWorkspace('generating', { brief: sourceBrief, briefAnswers: answers, characterNames: names, characterDetails: details });
    if (showWaiting) {
      setWaitingMode('preview');
      setWaitingDialogOpen(true);
      waitingRequestRef.current = controller;
    }
    setBriefError('');
    setBriefValidationError('');
    try {
      const nextPlan = await prepareStoryPreview({ ...draft, idea: draft.idea.trim() }, context, controller.signal);
      if (controller.signal.aborted) return;
      const nextCharacterNames = names.length ? names : nextPlan.characters.map((character) => character.name);
      setPlan(nextPlan);
      setCharacterNames(nextCharacterNames);
      void persistWorkspace('preview', { title: nextPlan.title, plan: nextPlan, brief: sourceBrief, briefAnswers: answers, characterNames: nextCharacterNames, characterDetails: details });
      savePendingStory(nextPlan, answers, nextCharacterNames, details, sourceBrief, { ...draft, idea: draft.idea.trim() });
      setFlow('preview');
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      setBriefError(error instanceof Error ? error.message : 'نتوانستم طرح اولیه را آماده کنم.');
      setBriefDialogOpen(true);
      return false;
    } finally {
      if (showWaiting && waitingRequestRef.current === controller) {
        waitingRequestRef.current = null;
        setWaitingDialogOpen(false);
      }
      setIsPreparingPlan(false);
    }
  };

  const closeOptimizationDialog = () => {
    if (optimizationCloseTimerRef.current) clearTimeout(optimizationCloseTimerRef.current);
    optimizationCloseTimerRef.current = null;
    optimizationRequestRef.current?.abort();
    optimizationRequestRef.current = null;
    setOptimizationDialogOpen(false);
  };

  const showOptimizationComplete = () => {
    if (optimizationCloseTimerRef.current) clearTimeout(optimizationCloseTimerRef.current);
    optimizationRequestRef.current = null;
    setOptimizationPhase('complete');
    setOptimizationDialogOpen(true);
    optimizationCloseTimerRef.current = setTimeout(() => {
      optimizationCloseTimerRef.current = null;
      setOptimizationDialogOpen(false);
    }, 2800);
  };

  const finishStoryOptimization = async (answers = briefAnswers, sourceBrief = brief, controller: AbortController) => {
    if (!sourceBrief) return false;
    setOptimizationPhase('updating');
    setOptimizationDialogOpen(true);
    const didUpdatePlan = await preparePlan(answers, characterNames, characterDetails, sourceBrief, { controller, showWaiting: false });
    if (didUpdatePlan && !controller.signal.aborted) {
      setPlanUpdateMessage('بازخوردت اعمال شد؛ داستان کلی، شخصیت‌ها و مسیر قصه بر اساس خواسته‌ات به‌روزرسانی شدند.');
      notify.success('داستانت به‌روزرسانی شد.');
      showOptimizationComplete();
    } else if (!controller.signal.aborted) {
      setOptimizationDialogOpen(false);
    }
    return didUpdatePlan;
  };

  const startIdeaOptimization = async (feedback: string) => {
    const context = makeContext();
    const normalizedFeedback = feedback.trim();
    if (!brief || !context || !normalizedFeedback) return;
    setIsOptimizingIdea(false);
    if (optimizationCloseTimerRef.current) clearTimeout(optimizationCloseTimerRef.current);
    optimizationCloseTimerRef.current = null;
    setOptimizationPhase('checking');
    setOptimizationDialogOpen(true);
    setPlanUpdateMessage('');
    setIsPreparingBrief(true);
    setBriefError('');
    setBriefValidationError('');
    setBriefDialogOpen(false);
    const controller = new AbortController();
    optimizationRequestRef.current = controller;
    try {
      const followUp = await clarifyStoryBrief({ ...draft, idea: draft.idea.trim() }, context, normalizedFeedback, controller.signal);
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
        if (optimizationRequestRef.current === controller) optimizationRequestRef.current = null;
        setOptimizationDialogOpen(false);
        setBriefQuestionIndex(brief.questions.length);
        setCustomAnswer('');
        setCustomAnswerOpen(false);
        setIsOptimizingIdea(true);
        setBriefDialogOpen(true);
      } else {
        await finishStoryOptimization(briefAnswers, nextBrief, controller);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setBriefError(error instanceof Error ? error.message : 'نتوانستم جزئیات لازم داستان را بررسی کنم.');
      setOptimizationDialogOpen(false);
      setBriefDialogOpen(true);
    } finally {
      setIsPreparingBrief(false);
      if (optimizationRequestRef.current === controller) optimizationRequestRef.current = null;
    }
  };

  const submitStoryImprovement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const feedback = improvementFeedback.trim();
    if (!feedback) {
      setImprovementError('بگو کدام بخش داستان را دوست نداشتی یا می‌خواهی تغییر کند.');
      return;
    }
    setImprovementError('');
    setImprovementDialogOpen(false);
    void startIdeaOptimization(feedback);
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
    const storyDraft = {
      ...draft,
      idea: draft.idea.trim(),
      length: 'custom' as const,
      customSceneCount: String(getSceneCountForDuration(duration))
    };
    setScenarioDialogOpen(true);
    setScenarioError('');
    setScenario('');
    setIsGenerating(true);
    void persistWorkspace('generating');
    const controller = new AbortController();
    scenarioRequestRef.current = controller;
    try {
      const result = await generateStoryScenario(storyDraft, context, controller.signal);
      setScenario(result.scenario);
      setScenarioStory(result.story);
      const storyId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const initialVersion: StoryVersion = { id: `${storyId}-v1`, createdAt: new Date().toISOString(), label: 'نسخه‌ی اول', scenario: result.scenario, story: result.story };
      setActiveStoryId(storyId);
      let completedWorkspaceId: string | undefined;
      try {
        const workspace = await persistWorkspace('completed', { title: result.story.title || plan?.title || 'داستان من', scenario: result.scenario, story: result.story, versions: [initialVersion] });
        completedWorkspaceId = workspace.id;
      } catch {
        // Keep a local entry when the cloud workspace cannot be saved.
      }
      setStoryHistory((items) => [{ id: storyId, workspaceId: completedWorkspaceId, title: getStoryTitle(result.scenario, characterNames[0] || ''), idea: storyDraft.idea, scenario: result.scenario, scenes: result.scenes, createdAt: initialVersion.createdAt, story: result.story, versions: [initialVersion] }, ...items].slice(0, 24));
      if (activePendingId) {
        setPendingStories((items) => items.filter((item) => item.id !== activePendingId));
        setActivePendingId(null);
      }
    } catch (error) {
      if (controller.signal.aborted) { void persistWorkspace('preview'); return; }
      setScenarioError(error instanceof Error ? error.message : 'سناریو ساخته نشد. لطفاً دوباره امتحان کن.');
    } finally { if (scenarioRequestRef.current === controller) scenarioRequestRef.current = null; setIsGenerating(false); }
  };

  const closeScenarioDialog = () => {
    if (isGenerating) {
      scenarioRequestRef.current?.abort();
      scenarioRequestRef.current = null;
      void persistWorkspace('preview');
    }
    setScenarioDialogOpen(false);
  };

  const cancelBrief = () => {
    briefRequestRef.current?.abort();
    briefRequestRef.current = null;
    setIsPreparingBrief(false);
    setBriefDialogOpen(false);
    setBriefError('');
    setBriefValidationError('');
  };

  const startBrief = async () => {
    briefRequestRef.current?.abort();
    const controller = new AbortController();
    briefRequestRef.current = controller;
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
    try { await persistWorkspace('briefing', { draft: { ...draft, idea: draft.idea.trim() }, brief: null, briefAnswers: {}, plan: null }); } catch { /* The guided flow can still continue while the connection recovers. */ }
    if (controller.signal.aborted) return;
    try {
      const nextBrief = await prepareStoryBrief({ ...draft, idea: draft.idea.trim() }, controller.signal);
      if (controller.signal.aborted) return;
      setBrief(nextBrief);
      void persistWorkspace('briefing', { brief: nextBrief, briefAnswers: {}, plan: null });
      if (nextBrief.status === 'ready' || nextBrief.questions.length === 0) {
        setBriefDialogOpen(false);
        void preparePlan({}, characterNames, characterDetails, nextBrief);
      } else {
        setBriefDialogOpen(true);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setBriefError(error instanceof Error ? error.message : 'نتوانستم ایده را بررسی کنم.');
    } finally {
      if (briefRequestRef.current === controller) {
        briefRequestRef.current = null;
        setIsPreparingBrief(false);
      }
    }
  };

  const applyAnswer = (answer: string) => {
    if (!brief || !activeBriefQuestion || !answer.trim()) return;
    const nextAnswers = { ...briefAnswers, [activeBriefQuestion.id]: answer.trim() };
    setBriefAnswers(nextAnswers);
    void persistWorkspace('briefing', { briefAnswers: nextAnswers });
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
      const wasOptimizingIdea = isOptimizingIdea;
      setBriefDialogOpen(false);
      setIsOptimizingIdea(false);
      if (wasOptimizingIdea) {
        const controller = new AbortController();
        optimizationRequestRef.current = controller;
        void finishStoryOptimization(nextAnswers, brief, controller);
      }
      else void preparePlan(nextAnswers);
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

  const startCharacterDesign = () => {
    if (!scenario.trim()) return;
    onOpenCharacterMaker?.(scenario, scenarioStory?.title || plan?.title || 'سناریوی من');
  };

  const resumePendingStory = (item: StoryPendingItem) => {
    setDraft(item.draft);
    setBrief(discardLegacyFollowUpQuestions(item.brief));
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
    setPlanUpdateMessage('');
    setActiveTab('create');
    setFlow('preview');
    window.requestAnimationFrame(() => document.getElementById('story-create-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const saveEditedStory = ({ story, scenario: nextScenario, label }: { story: StoryScenario; scenario: string; label: string }) => {
    if (!activeStoryId) return;
    const version: StoryVersion = { id: `${activeStoryId}-${Date.now()}`, createdAt: new Date().toISOString(), label, scenario: nextScenario, story };
    setScenario(nextScenario); setScenarioStory(story);
    setStoryHistory((items) => items.map((item) => item.id === activeStoryId ? { ...item, title: story.title || item.title, scenario: nextScenario, story, versions: [...(item.versions || []), version].slice(-12) } : item));
    void persistWorkspace('completed', { title: story.title || plan?.title || 'داستان من', scenario: nextScenario, story, versions: [...activeVersions, version].slice(-12) });
    notify.success('نسخه‌ی تازه‌ی سناریو ذخیره شد.');
  };

  const restoreStoryVersion = (version: StoryVersion) => {
    if (!activeStoryId) return;
    setScenario(version.scenario); setScenarioStory(version.story);
    setStoryHistory((items) => items.map((item) => item.id === activeStoryId ? { ...item, title: version.story.title || item.title, scenario: version.scenario, story: version.story } : item));
    notify.success('این نسخه دوباره فعال شد.');
  };

  const activeVersions = storyHistory.find((item) => item.id === activeStoryId)?.versions || [];
  const remotePendingWorkspaces = remoteWorkspaces.filter((item) => item.status !== 'completed');
  const remoteCompletedWorkspaces = remoteWorkspaces.filter((item) => item.status === 'completed');
  const remoteCompletedIds = new Set(remoteCompletedWorkspaces.map((item) => item.id));
  const legacyHistory = storyHistory.filter((item) => !item.workspaceId || !remoteCompletedIds.has(item.workspaceId));
  const savedStoryCount = pendingStories.length + remotePendingWorkspaces.length + remoteCompletedWorkspaces.length + legacyHistory.length;

  return (
    <main className="story-maker" dir="rtl" id="main-content">
      <header className="story-maker__header">
        <button type="button" className="story-maker__back" onClick={onBack} aria-label="بازگشت به استودیو" title="بازگشت به استودیو"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6" /></svg></button>
        <div className="story-maker__brand"><span className="story-maker__brand-mark" aria-hidden="true"><Icon name="story" size={22} /></span><span><strong>سناریو نویسی ( داستان من )</strong><small>ایده‌ات را به یک سناریوی حرفه‌ای تبدیل کن</small></span></div>
        <span className="story-maker__header-spacer" aria-hidden="true" />
      </header>

      <nav className="story-maker__tabs" role="tablist" aria-label="بخش‌های داستان‌نویسی">
        <button id="story-create-tab" type="button" role="tab" aria-selected={activeTab === 'create'} aria-controls="story-create-panel" tabIndex={activeTab === 'create' ? 0 : -1} className={activeTab === 'create' ? 'is-active' : ''} onClick={() => setActiveTab('create')} onKeyDown={handleTabKey}><Icon name="story" size={18} aria-hidden="true" /> ساخت داستان</button>
        <button id="story-history-tab" type="button" role="tab" aria-selected={activeTab === 'history'} aria-controls="story-history-panel" tabIndex={activeTab === 'history' ? 0 : -1} className={activeTab === 'history' ? 'is-active' : ''} onClick={() => setActiveTab('history')} onKeyDown={handleTabKey}><Icon name="book" size={18} aria-hidden="true" /> داستان‌های من {savedStoryCount ? <span>{savedStoryCount}</span> : null}</button>
      </nav>

      {activeTab === 'create' ? <div className="story-maker__shell" id="story-create-panel" role="tabpanel" aria-labelledby="story-create-tab">
        {flow === 'idea' ? <section className="story-maker__idea-stage" aria-labelledby="story-maker-title">
          <div className="story-maker__idea-overview">
            <h1 id="story-maker-title">داستانت دربارهٔ چیست؟</h1>
          </div>
          <form className="story-maker__idea-form" onSubmit={prepareScenario} noValidate>
            <div className="story-maker__idea-form-heading"><span className="story-maker__idea-form-icon"><Icon name="edit" size={19} aria-hidden="true" /></span><div><strong>ایدهٔ داستانت را بنویس</strong><small>فقط چیزی که توی ذهنت هست رو بنویس</small></div></div>
            <label className="story-maker__field" htmlFor="story-idea"><span>داستان من درباره‌ی…</span><textarea ref={ideaInputRef} id="story-idea" dir="rtl" autoFocus={!routeWorkspaceId} value={draft.idea} onChange={(event) => setDraft((current) => ({ ...current, idea: event.target.value.slice(0, 240) }))} onKeyDown={(event) => { if (event.ctrlKey && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} onBlur={() => setIdeaTouched(true)} aria-keyshortcuts="Control+Enter" aria-invalid={Boolean(ideaError)} aria-describedby={ideaError ? 'story-idea-error' : undefined} placeholder="مثلاً یک گربه‌ی فضایی که دنبال سیاره‌ی بستنی‌ها می‌گردد" maxLength={240} /></label>
            <div className="story-maker__field-meta"><span>{draft.idea.length}/۲۴۰</span></div>
            {ideaError ? <p id="story-idea-error" className="story-maker__error" role="alert">{ideaError}</p> : null}
            <div className="story-maker__submit"><Button type="submit" size="lg" loading={isPreparingBrief} className="story-maker__submit-button" endIcon={<Icon name="sparkle" size={19} />}>{isPreparingBrief ? 'داریم پیشنهادهای مناسب را آماده می‌کنیم…' : 'ثبت ایده و ادامه'}</Button></div>
          </form>
        </section> : <section className="story-maker__plan-stage" aria-labelledby="story-plan-title">
          {isPreparingPlan ? <div className="story-maker__dialog-loading story-maker__plan-loading" role="status" aria-live="polite"><Icon name="spinner" size={32} aria-hidden="true" /><strong>داریم طرح اولیه‌ی قصه را می‌چینیم…</strong><span>شخصیت‌ها، دنیای داستان و مسیر کلی را با انتخاب‌هایت هماهنگ می‌کنیم.</span><div className="story-maker__plan-progress" role="progressbar" aria-label="در حال آماده‌سازی طرح اولیه" aria-valuetext="در حال آماده‌سازی طرح اولیه"><i /></div><small>سناریوی نهایی هنوز ساخته نمی‌شود.</small></div> : plan ? <>
            {planUpdateMessage ? <div className="story-maker__plan-update" role="status" aria-live="polite"><span aria-hidden="true"><Icon name="check" size={18} /></span><div><strong>داستانت به‌روزرسانی شد</strong><p>{planUpdateMessage}</p></div><button type="button" onClick={() => setPlanUpdateMessage('')} aria-label="بستن پیام به‌روزرسانی">×</button></div> : null}
                        <aside className="story-maker__plan-banner" role="note" aria-label="راهنمای طرح اولیه">
              <span className="story-maker__plan-banner-icon" aria-hidden="true">
                <Icon name="lightbulb" size={19} />
              </span>
              <p>این انتخاب‌ها، مبنای ساخت سناریوی نهایی هستند؛ فعلاً فقط نقشه‌ی راه را می‌بینی و صحنه‌ها و دیالوگ‌ها هنوز ساخته نشده‌اند.</p>
            </aside>
            <article className="story-maker__plan-unified-card" aria-labelledby="story-plan-title">
              {/* بخش ۱: خلاصه داستان */}
              <div className="story-maker__plan-section story-maker__plan-section--summary">
                <span className="story-maker__eyebrow"><Icon name="sparkle" size={15} aria-hidden="true" /> خلاصه داستان</span>
                <h1 id="story-plan-title" className="story-maker__plan-title">{plan.title}</h1>
                <p className="story-maker__plan-overview">{plan.overview}</p>
              </div>

              <div className="story-maker__plan-divider" role="separator" aria-hidden="true" />

              {/* بخش ۲: مسیر کلی قصه (ضرب‌آهنگ روایی) */}
              <section className="story-maker__plan-section story-maker__plan-section--path" aria-labelledby="story-path-title">
                <div className="story-maker__plan-section-head">
                  <div className="story-maker__plan-section-title">
                    <span className="story-maker__plan-section-icon" aria-hidden="true"><Icon name="story" size={18} /></span>
                    <h2 id="story-path-title">مسیر کلی قصه</h2>
                  </div>
                  <div className="story-maker__plan-section-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => { setImprovementError(''); setImprovementDialogOpen(true); }}
                      startIcon={<Icon name="sparkle" size={15} aria-hidden="true" />}
                      className="story-maker__section-action-btn story-maker__section-action-btn--magic"
                    >
                      داستان را بهترش کن
                    </Button>
                  </div>
                </div>
                <div className="story-maker__path-timeline">
                  <div className="story-maker__path-step story-maker__path-step--start">
                    <span className="story-maker__path-step-badge">شروع</span>
                    <p>{plan.storyPath.beginning}</p>
                  </div>
                  <div className="story-maker__path-step story-maker__path-step--challenge">
                    <span className="story-maker__path-step-badge">چالش</span>
                    <p>{plan.storyPath.challenge}</p>
                  </div>
                  <div className="story-maker__path-step story-maker__path-step--climax">
                    <span className="story-maker__path-step-badge">اوج</span>
                    <p>{plan.storyPath.climax}</p>
                  </div>
                  <div className="story-maker__path-step story-maker__path-step--resolution">
                    <span className="story-maker__path-step-badge">فرجام</span>
                    <p>{plan.storyPath.resolution}</p>
                  </div>
                </div>
              </section>

              <div className="story-maker__plan-divider" role="separator" aria-hidden="true" />

              {/* بخش ۳: شخصیت‌ها */}
              <section className="story-maker__plan-section story-maker__plan-section--characters" aria-labelledby="story-characters-title">
                <div className="story-maker__plan-section-head">
                  <div className="story-maker__plan-section-title">
                    <span className="story-maker__plan-section-icon" aria-hidden="true"><Icon name="companion" size={18} /></span>
                    <h2 id="story-characters-title">شخصیت‌ها</h2>
                  </div>
                  <div className="story-maker__plan-section-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={openCharacterEditor}
                      startIcon={<Icon name="edit" size={15} aria-hidden="true" />}
                      className="story-maker__section-action-btn story-maker__section-action-btn--characters"
                    >
                      ویرایش نام شخصیت‌ها
                    </Button>
                  </div>
                </div>
                <div className="story-maker__characters-grid">
                  {plan.characters.map((character) => (
                    <div key={`${character.name}-${character.role}`} className="story-maker__character-item">
                      <div className="story-maker__character-head">
                        <strong>{character.name}</strong>
                        <span className="story-maker__character-role">{character.role}</span>
                      </div>
                      <p>{character.description}</p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="story-maker__plan-divider" role="separator" aria-hidden="true" />

              {/* بخش ۴: دنیای داستان و مشخصات */}
              <section className="story-maker__plan-section story-maker__plan-section--world" aria-labelledby="story-world-title">
                <div className="story-maker__plan-section-head">
                  <div className="story-maker__plan-section-title">
                    <span className="story-maker__plan-section-icon" aria-hidden="true"><Icon name="star" size={18} /></span>
                    <h2 id="story-world-title">دنیای داستان و مشخصات</h2>
                  </div>
                  <div className="story-maker__plan-section-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setAnswerPickerOpen(true)}
                      startIcon={<Icon name="edit" size={15} aria-hidden="true" />}
                      className="story-maker__section-action-btn story-maker__section-action-btn--world"
                    >
                      ویرایش جزئیات
                    </Button>
                  </div>
                </div>
                <div className="story-maker__world-body">
                  <div className="story-maker__world-place">
                    <small>محل و فضای داستان</small>
                    <p>{plan.world}</p>
                  </div>
                  <div className="story-maker__world-tags">
                    <span className="story-maker__world-tag">
                      <small>قالب</small>
                      <strong>{plan.format}</strong>
                    </span>
                    <span className="story-maker__world-tag">
                      <small>مدت</small>
                      <strong>{plan.duration}</strong>
                    </span>
                    <span className="story-maker__world-tag">
                      <small>لحن</small>
                      <strong>{plan.tone}</strong>
                    </span>
                  </div>
                </div>
              </section>

                            {/* نوار عملیات نهایی درون فوتر کارت */}
              <footer className="story-maker__plan-footer story-maker__plan-footer--center">
                <Button
                  type="button"
                  size="lg"
                  loading={isGenerating}
                  onClick={() => void runScenarioGeneration()}
                  endIcon={<Icon name="sparkle" size={19} aria-hidden="true" />}
                  className="story-maker__generate-btn story-maker__generate-btn--hero"
                >
                  اوکیه، سناریو رو بساز
                </Button>
              </footer>
            </article>
          </> : null}
        </section>}
      </div> : <section className="story-maker__history" id="story-history-panel" role="tabpanel" aria-labelledby="story-history-tab">
        <div className="story-maker__history-heading"><div><span className="story-maker__eyebrow"><Icon name="book" size={15} aria-hidden="true" /> کتابخانه‌ی من</span><h1>داستان‌های من</h1><p>سناریوهای نهایی و طرح‌هایی که هنوز منتظر تأیید تو هستند.</p></div><span className="story-maker__history-count">{savedStoryCount} مورد</span></div>
        {pendingStories.length ? <section className="story-maker__history-section" aria-labelledby="pending-stories-title"><div className="story-maker__history-section-heading"><div><span className="story-maker__pending-label"><Icon name="sparkle" size={14} aria-hidden="true" /> در انتظار تأیید</span><h2 id="pending-stories-title">طرح‌های نیمه‌کاره</h2></div><small>از همین‌جا ادامه بده</small></div><div className="story-maker__history-grid">{pendingStories.map((item) => <button key={item.id} type="button" className="story-maker__history-card story-maker__history-card--pending" onClick={() => resumePendingStory(item)} aria-label={`ادامه‌ی طرح ${item.plan.title}`}><span className="story-maker__history-card-icon"><Icon name="sparkle" size={22} aria-hidden="true" /></span><span className="story-maker__history-card-body"><strong>{item.plan.title}</strong><span className="story-maker__history-idea">{item.draft.idea}</span><span className="story-maker__history-meta"><span>طرح اولیه آماده است</span><span>{formatStoryDate(item.updatedAt)}</span></span></span><span className="story-maker__continue-label">ادامه</span><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}</div></section> : null}
        {remotePendingWorkspaces.length ? <section className="story-maker__history-section" aria-labelledby="cloud-stories-title"><div className="story-maker__history-section-heading"><div><span className="story-maker__pending-label"><Icon name="sparkle" size={14} aria-hidden="true" /> در انتظار تأیید</span><h2 id="cloud-stories-title">طرح‌های نیمه‌کاره</h2></div><small>روی هر طرح بزن و از همان مرحله ادامه بده</small></div><div className="story-maker__history-grid">{remotePendingWorkspaces.map((item) => <button key={item.id} type="button" className="story-maker__history-card story-maker__history-card--pending" onClick={() => onOpenWorkspace?.(item.id)} aria-label={`ادامه‌ی طرح ${item.title}`}><span className="story-maker__history-card-icon"><Icon name="sparkle" size={22} aria-hidden="true" /></span><span className="story-maker__history-card-body"><strong>{item.title}</strong><span className="story-maker__history-idea">{item.idea}</span><span className="story-maker__history-meta"><span>{item.status === 'preview' ? 'منتظر تأیید' : 'در حال تکمیل'}</span><span>{formatStoryDate(item.updatedAt)}</span></span></span><span className="story-maker__continue-label">ادامه</span><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}</div></section> : null}
        {remoteCompletedWorkspaces.length || legacyHistory.length ? <section className="story-maker__history-section" aria-labelledby="finished-stories-title"><div className="story-maker__history-section-heading"><div><span className="story-maker__history-label">سناریوهای نهایی</span><h2 id="finished-stories-title">داستان‌های کامل‌شده</h2></div><small>برای دیدن سناریو روی داستان بزن</small></div><div className="story-maker__history-grid">{remoteCompletedWorkspaces.map((item) => <button key={item.id} type="button" className="story-maker__history-card" onClick={() => onOpenWorkspace?.(item.id)} aria-label={`باز کردن سناریوی ${item.title}`}><span className="story-maker__history-card-icon"><Icon name="story" size={22} aria-hidden="true" /></span><span className="story-maker__history-card-body"><strong>{item.title}</strong><span className="story-maker__history-idea">{item.idea}</span><span className="story-maker__history-meta"><span>سناریوی نهایی</span><span>{formatStoryDate(item.updatedAt)}</span></span></span><span className="story-maker__continue-label">باز کن</span><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}{legacyHistory.map((item) => <button key={item.id} type="button" className="story-maker__history-card" onClick={() => openHistoryStory(item)} aria-label={`باز کردن ${item.title}`}><span className="story-maker__history-card-icon"><Icon name="story" size={22} aria-hidden="true" /></span><span className="story-maker__history-card-body"><strong>{item.title}</strong><span className="story-maker__history-idea">{item.idea}</span><span className="story-maker__history-meta"><span>{item.scenes} صحنه</span><span>{formatStoryDate(item.createdAt)}</span></span></span><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}</div></section> : null}
        {!savedStoryCount ? <div className="story-maker__history-empty"><span><Icon name="book" size={32} aria-hidden="true" /></span><h2>کتاب داستانت هنوز خالیه</h2><p>اولین داستانت را بساز؛ بعد همیشه همین‌جا پیدایش می‌کنی.</p><Button type="button" onClick={() => { setActiveTab('create'); setFlow('idea'); }} startIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>ساخت داستان تازه</Button></div> : null}
      </section>}

      <Dialog open={improvementDialogOpen} title="داستان را بهترش کن" onClose={() => setImprovementDialogOpen(false)} showFooter={false} panelClassName="story-maker__improvement-dialog">
        <form className="story-maker__improvement-form" onSubmit={submitStoryImprovement} noValidate>
          <div><strong>چه چیزی در داستان دوست نداشتی؟</strong><p>هر تغییری که در ذهنت هست بنویس؛ از همان برای بهتر کردن طرح استفاده می‌کنیم.</p></div>
          <textarea value={improvementFeedback} onChange={(event) => { setImprovementFeedback(event.target.value.slice(0, 800)); setImprovementError(''); }} placeholder="مثلاً قهرمانش را دوست نداشتم، چالش داستان بیشتر باشد یا پایانش شادتر شود." autoFocus maxLength={800} aria-invalid={Boolean(improvementError)} aria-describedby={improvementError ? 'story-improvement-error' : undefined} />
          <div className="story-maker__improvement-meta"><span>{improvementFeedback.length}/۸۰۰</span></div>
          {improvementError ? <p id="story-improvement-error" className="story-maker__error" role="alert">{improvementError}</p> : null}
          <div className="story-maker__improvement-actions"><Button type="button" variant="secondary" onClick={() => setImprovementDialogOpen(false)}>انصراف</Button><Button type="submit" loading={isPreparingBrief} endIcon={<Icon name="sparkle" size={17} />}>بررسی و بهترش کن</Button></div>
        </form>
      </Dialog>

      <Dialog open={briefDialogOpen} title={briefDialogTitle} headerContent={briefProgress} onClose={isPreparingBrief ? cancelBrief : () => setBriefDialogOpen(false)} showFooter={false} panelClassName={`story-maker__brief-dialog${isPreparingBrief ? ' story-maker__processing-dialog' : ''}`}>
        {isPreparingBrief ? <StoryProcessingCard stage={0} headline="داستانت داره آماده می‌شه" support="یک لحظه کوچولو…" onCancel={cancelBrief} /> : null}
        {briefError ? <div className="story-maker__dialog-error" role="alert"><Icon name="alert-triangle" size={22} aria-hidden="true" /><p>{briefError}</p><div className="story-maker__brief-actions"><Button type="button" variant="secondary" onClick={() => setBriefDialogOpen(false)}>بستن</Button><Button type="button" onClick={() => void startBrief()}>دوباره تلاش کن</Button></div></div> : null}
        {brief && activeBriefQuestion && !briefError ? (
          <div className="story-maker__brief-content">
            <section key={activeBriefQuestion.id} className="story-maker__brief-question story-maker__brief-question--active" aria-label={activeBriefQuestion.question} aria-live="polite">
              <div>
                {isDurationQuestion ? (
                  <div className="story-maker__duration-picker">
                    <div className="story-maker__duration-options" role="radiogroup" aria-label="انتخاب مدت داستان">
                      {durationPresetOptions.map((seconds) => <button key={seconds} type="button" role="radio" aria-checked={selectedDurationPreset === seconds} className={selectedDurationPreset === seconds ? 'is-selected' : ''} onClick={() => applyAnswer(`${new Intl.NumberFormat('fa-IR').format(seconds)} ثانیه`)}><strong>{new Intl.NumberFormat('fa-IR').format(seconds)}</strong><span>ثانیه</span></button>)}
                      <button type="button" role="radio" aria-checked={customAnswerOpen || customDurationSelected} className={customAnswerOpen || customDurationSelected ? 'is-selected' : ''} onClick={() => { setCustomAnswerOpen(true); setDurationSeconds(selectedDuration || 10); }}><strong>خودم می‌نویسم</strong><span>مدت دلخواه</span></button>
                    </div>
                    {customAnswerOpen ? <form className="story-maker__duration-custom" onSubmit={(event) => { event.preventDefault(); applyAnswer(`${new Intl.NumberFormat('fa-IR').format(durationSeconds)} ثانیه`); }}><label htmlFor="story-duration-number">مدت به ثانیه</label><input id="story-duration-number" type="number" min="2" max="60" inputMode="numeric" value={durationSeconds} onChange={(event) => setDurationSeconds(clampDuration(Number(event.target.value)))} autoFocus /><span>ثانیه</span><Button type="submit" size="sm">ثبت و ادامه</Button></form> : null}
                  </div>
                ) : (
                  <>
                    <div className="story-maker__brief-options" role="radiogroup" aria-label={activeBriefQuestion.question}>{activeBriefQuestion.options.map((option) => <button key={option} type="button" role="radio" aria-checked={briefAnswers[activeBriefQuestion.id] === option} className={briefAnswers[activeBriefQuestion.id] === option ? 'is-selected' : ''} onClick={() => applyAnswer(option)}>{option}{briefAnswers[activeBriefQuestion.id] === option ? <OptionCheck /> : null}</button>)}{allowsCustomBriefAnswer ? <button type="button" className={customAnswerOpen ? 'is-selected' : ''} onClick={() => { setCustomAnswerOpen(true); setCustomAnswer(briefAnswers[activeBriefQuestion.id] || ''); }}>خودم می‌نویسم</button> : null}</div>
                    {allowsCustomBriefAnswer && customAnswerOpen ? <form className="story-maker__custom-answer" onSubmit={(event) => { event.preventDefault(); applyAnswer(customAnswer); }}><input value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value.slice(0, 100))} placeholder="انتخاب خودت را بنویس" autoFocus maxLength={100} /><Button type="submit" size="sm">ثبت انتخاب</Button></form> : null}
                  </>
                )}
                {briefValidationError ? <p className="story-maker__error" role="alert">{briefValidationError}</p> : null}
              </div>
            </section>
            <div className="story-maker__brief-actions">{!editingQuestionId && briefQuestionIndex && !isImprovementQuestion ? <Button type="button" variant="secondary" onClick={() => setBriefQuestionIndex((index) => Math.max(0, index - 1))}>سؤال قبلی</Button> : <Button type="button" variant="secondary" onClick={() => setBriefDialogOpen(false)}>فعلاً بعداً</Button>}<span className="story-maker__brief-next-hint">{isImprovementQuestion ? 'یک گزینه انتخاب کن یا جواب خودت را بنویس.' : isDurationQuestion ? 'یک زمان را انتخاب کن یا خودت واردش کن.' : 'یک گزینه انتخاب کن تا ادامه بدهیم.'}</span></div>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={waitingDialogOpen} title="در حال آماده‌سازی" onClose={cancelWaiting} closeLabel="برگشت" showFooter={false} panelClassName="story-maker__wait-dialog story-maker__processing-dialog">
        <StoryProcessingCard
          stage={waitingMode === 'preview' ? 1 : 2}
          headline={waitingMode === 'preview' ? 'داستانت داره شکل می‌گیره' : 'تقریباً آماده‌ست!'}
          support={waitingMode === 'preview' ? 'داریم جزئیاتش رو کنار هم می‌چینیم…' : 'تغییرها رو با قصه‌ات هماهنگ می‌کنیم…'}
          onCancel={cancelWaiting}
        />
      </Dialog>

      <Dialog open={optimizationDialogOpen} title={optimizationPhase === 'complete' ? 'داستانت بهتر شد' : optimizationPhase === 'updating' ? 'داریم تغییرها را اعمال می‌کنیم' : 'داریم داستانت را بررسی می‌کنیم'} onClose={closeOptimizationDialog} closeLabel="انصراف از بهینه‌سازی" showFooter={false} panelClassName="story-maker__wait-dialog story-maker__optimization-dialog">
        {optimizationPhase === 'complete' ? <div className="story-maker__optimization-complete" role="status" aria-live="polite"><span aria-hidden="true"><Icon name="check" size={28} /></span><div><strong>اوکی شد!</strong><p>تغییرها اعمال شد و طرحِ داستانت به‌روز است.</p></div><Button type="button" variant="secondary" onClick={closeOptimizationDialog}>بستن</Button></div> : <div className="story-maker__wait-content" role="status" aria-live="polite">
          <span className="story-maker__wait-spinner" aria-hidden="true"><Icon name="spinner" size={25} /></span>
          <div className="story-maker__wait-copy"><strong>{optimizationPhase === 'checking' ? 'داریم بازخوردت را بررسی می‌کنیم' : 'داریم بازخوردت را در طرح داستان اعمال می‌کنیم'}</strong><p>{optimizationPhase === 'checking' ? 'فقط اگر ضروری باشد، حداکثر دو سؤال کوتاه و هدفمند می‌پرسیم.' : 'شخصیت‌ها، دنیای داستان و مسیر قصه را با خواسته‌ات هماهنگ می‌کنیم.'}</p></div>
          <div className="story-maker__wait-progress" aria-hidden="true"><i /></div>
          <small className="story-maker__wait-caption"><Icon name="check" size={14} aria-hidden="true" /> بازخوردت ثبت شد</small>
        </div>}
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

      <Dialog
        open={scenarioDialogOpen}
        title={isGenerating ? '' : scenarioError ? 'دوباره امتحان کنیم؟' : 'سناریوی تو آماده شد!'}
        onClose={closeScenarioDialog}
        closeLabel={isGenerating ? 'لغو ساخت سناریو' : 'بستن پنجره'}
        showFooter={false}
        panelClassName={`story-maker__dialog${isGenerating ? ' story-maker__dialog--game' : ''}`}
      >
        {isGenerating ? <StoryWormGame onCancel={closeScenarioDialog} /> : null}
        {scenarioError ? <div className="story-maker__dialog-error" role="alert"><Icon name="alert-triangle" size={22} aria-hidden="true" /><p>{scenarioError}</p><Button type="button" onClick={() => void runScenarioGeneration()}>دوباره بساز</Button></div> : null}
        {scenario ? <><aside className="story-maker__character-handoff" aria-label="مرحله بعدی ساخت کاراکتر"><span><Icon name="family" size={20} aria-hidden="true" /></span><div><strong>قدم بعدی: طراحی کاراکترها</strong><p>سناریو را آماده به کارگاه ساخت کاراکتر می‌بریم؛ تحلیل فقط با تأیید تو شروع می‌شود.</p></div></aside><article className="story-maker__scenario" aria-label="سناریوی نهایی"><ReactMarkdown remarkPlugins={[remarkGfm]}>{scenario}</ReactMarkdown></article><div className="story-maker__dialog-actions"><Button type="button" className="story-maker__design-characters" onClick={startCharacterDesign} startIcon={<Icon name="family" size={18} aria-hidden="true" />}>طراحی کاراکترها</Button><div className="story-maker__dialog-secondary-actions">{scenarioStory ? <Button type="button" variant="secondary" onClick={() => { closeScenarioDialog(); setEditorOpen(true); }} startIcon={<Icon name="edit" size={18} aria-hidden="true" />}>ویرایش سناریو</Button> : null}<Button type="button" variant="secondary" onClick={() => void copyScenario()} startIcon={<Icon name="copy" size={18} aria-hidden="true" />}>کپی سناریو</Button><Button type="button" variant="ghost" onClick={closeScenarioDialog}>بستن</Button></div></div></> : null}
      </Dialog>
      <StoryEditorDialog open={editorOpen} story={scenarioStory} expectedScenes={scenarioStory?.scenes.length || 0} versions={activeVersions} onClose={() => setEditorOpen(false)} onSaved={saveEditedStory} onRestore={restoreStoryVersion} />
    </main>
  );
}
