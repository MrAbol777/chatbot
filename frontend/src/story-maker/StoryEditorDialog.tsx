import { KeyboardEvent, useEffect, useState } from 'react';
import { Button, Dialog } from '../design-system/components';
import Icon from '../components/Icon';
import { reviseStoryScenario, validateStoryScenario } from './storyMaker.api';
import type { StoryScenario, StoryVersion } from './storyMaker.types';
import './StoryEditorDialog.css';

type Props = {
  open: boolean;
  story: StoryScenario | null;
  expectedScenes: number;
  versions: StoryVersion[];
  onClose: () => void;
  onSaved: (result: { story: StoryScenario; scenario: string; label: string }) => void;
  onRestore: (version: StoryVersion) => void;
};

type EditorTab = 'ai' | 'manual';
type SceneField = Exclude<keyof StoryScenario['scenes'][number], 'number'>;

const sceneFields: Array<{ key: SceneField; label: string; rows?: number }> = [
  { key: 'goal', label: 'هدف صحنه' }, { key: 'setting', label: 'فضا' }, { key: 'visual', label: 'تصویر' }, { key: 'camera', label: 'دوربین' },
  { key: 'duration', label: 'زمان این بخش' }, { key: 'presentCharacters', label: 'شخصیت‌های حاضر' }, { key: 'emotion', label: 'حسِ اصلی' }, { key: 'action', label: 'اتفاقی که می‌افتد', rows: 3 }, { key: 'dialogue', label: 'حرف شخصیت', rows: 3 }, { key: 'narration', label: 'صدای راوی' }, { key: 'reaction', label: 'واکنش شخصیت‌ها' }, { key: 'sound', label: 'صدا و موسیقی' },
  { key: 'continuity', label: 'ارتباط با بخش قبل' }, { key: 'outcome', label: 'نتیجه‌ی این بخش' }, { key: 'transition', label: 'رفتن به بخش بعد' }, { key: 'imagePrompt', label: 'متنِ ساخت تصویر یا ویدیو', rows: 3 }
];

export default function StoryEditorDialog({ open, story, expectedScenes, versions, onClose, onSaved, onRestore }: Props) {
  const [tab, setTab] = useState<EditorTab>('ai');
  const [editableStory, setEditableStory] = useState<StoryScenario | null>(story);
  const [request, setRequest] = useState('');
  const [targetScene, setTargetScene] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setEditableStory(story);
    setRequest('');
    setTargetScene(null);
    setError('');
    setTab('ai');
  }, [open, story]);

  const chooseTab = (next: EditorTab) => setTab(next);
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'ArrowRight' || event.key === 'Home' ? 'ai' : event.key === 'ArrowLeft' || event.key === 'End' ? 'manual' : null;
    if (!next) return;
    event.preventDefault();
    chooseTab(next);
    window.requestAnimationFrame(() => document.getElementById(`story-editor-${next}-tab`)?.focus());
  };

  const updateStory = <K extends Exclude<keyof StoryScenario, 'characters' | 'scenes' | 'storyBeats'>>(key: K, value: StoryScenario[K]) => {
    setEditableStory((current) => current ? { ...current, [key]: value } : current);
  };
  const updateBeat = (key: keyof StoryScenario['storyBeats'], value: string) => setEditableStory((current) => current ? { ...current, storyBeats: { ...current.storyBeats, [key]: value } } : current);
  const updateCharacter = (index: number, key: keyof StoryScenario['characters'][number], value: string) => setEditableStory((current) => current ? { ...current, characters: current.characters.map((character, characterIndex) => characterIndex === index ? { ...character, [key]: value } : character) } : current);
  const updateScene = (index: number, key: SceneField, value: string) => setEditableStory((current) => current ? { ...current, scenes: current.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, [key]: value } : scene) } : current);

  const saveWithAi = async () => {
    if (!editableStory || !request.trim()) { setError('بگو دوست داری چه چیزی تغییر کند.'); return; }
    setBusy(true); setError('');
    try {
      const result = await reviseStoryScenario(editableStory, expectedScenes, request.trim(), targetScene || undefined);
      setEditableStory(result.story);
      onSaved({ story: result.story, scenario: result.scenario, label: targetScene ? `ویرایش صحنه ${targetScene} با دانوآ` : 'ویرایش داستان با دانوآ' });
      setRequest('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ویرایش انجام نشد.'); } finally { setBusy(false); }
  };

  const saveManual = async () => {
    if (!editableStory) return;
    setBusy(true); setError('');
    try {
      const result = await validateStoryScenario(editableStory, expectedScenes);
      setEditableStory(result.story);
      onSaved({ story: result.story, scenario: result.scenario, label: 'ویرایش دستی' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'بعضی بخش‌های ضروری کامل نیستند.'); } finally { setBusy(false); }
  };

  return <Dialog open={open} title="ویرایش سناریو" onClose={onClose} showFooter={false} panelClassName="story-editor-dialog">
    {!editableStory ? <div className="story-editor-empty"><Icon name="alert-triangle" size={22} aria-hidden="true" /><p>این سناریو داده‌ی قابل‌ویرایش ندارد.</p></div> : <div className="story-editor" dir="rtl">
      <div className="story-editor__tabs" role="tablist" aria-label="روش ویرایش سناریو">
        <button id="story-editor-ai-tab" type="button" role="tab" aria-selected={tab === 'ai'} aria-controls="story-editor-ai-panel" tabIndex={tab === 'ai' ? 0 : -1} className={tab === 'ai' ? 'is-active' : ''} onClick={() => chooseTab('ai')} onKeyDown={handleTabKey}><Icon name="sparkle" size={17} aria-hidden="true" /> با دانوآ</button>
        <button id="story-editor-manual-tab" type="button" role="tab" aria-selected={tab === 'manual'} aria-controls="story-editor-manual-panel" tabIndex={tab === 'manual' ? 0 : -1} className={tab === 'manual' ? 'is-active' : ''} onClick={() => chooseTab('manual')} onKeyDown={handleTabKey}><Icon name="edit" size={17} aria-hidden="true" /> ویرایش دستی</button>
      </div>
      {error ? <p className="story-editor__error" role="alert">{error}</p> : null}

      {tab === 'ai' ? <section id="story-editor-ai-panel" role="tabpanel" aria-labelledby="story-editor-ai-tab" className="story-editor__ai"><div className="story-editor__intro"><span><Icon name="sparkle" size={19} aria-hidden="true" /></span><div><strong>چی را عوض کنیم؟</strong><p>دانوآ فقط همان بخشی را که انتخاب می‌کنی تغییر می‌دهد و بقیه‌ی داستان را نگه می‌دارد.</p></div></div><label htmlFor="story-editor-request">درخواست ویرایش<textarea id="story-editor-request" value={request} onChange={(event) => setRequest(event.target.value.slice(0, 500))} placeholder="مثلاً صحنه را خنده‌دارتر کن و دیالوگ پوفی کوتاه‌تر باشد." maxLength={500} /></label><div className="story-editor__scope"><span>کدام بخش؟</span><div role="radiogroup" aria-label="محدوده‌ی ویرایش"><button type="button" role="radio" aria-checked={targetScene === null} className={targetScene === null ? 'is-selected' : ''} onClick={() => setTargetScene(null)}>همه‌ی داستان</button>{editableStory.scenes.map((scene) => <button key={scene.number} type="button" role="radio" aria-checked={targetScene === scene.number} className={targetScene === scene.number ? 'is-selected' : ''} onClick={() => setTargetScene(scene.number)}>صحنه {scene.number}</button>)}</div></div><Button type="button" loading={busy} onClick={() => void saveWithAi()} endIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>اعمال تغییر با دانوآ</Button></section> : <section id="story-editor-manual-panel" role="tabpanel" aria-labelledby="story-editor-manual-tab" className="story-editor__manual"><div className="story-editor__manual-grid"><label>عنوان<input value={editableStory.title} onChange={(event) => updateStory('title', event.target.value)} /></label><label>مناسب برای<input value={editableStory.audience} onChange={(event) => updateStory('audience', event.target.value)} /></label><label>مدت تقریبی<input value={editableStory.duration} onChange={(event) => updateStory('duration', event.target.value)} /></label><label>اتفاق جذابِ شروع<textarea value={editableStory.openingHook} onChange={(event) => updateStory('openingHook', event.target.value)} /></label><label>خلاصه‌ی کوتاه<textarea value={editableStory.logline} onChange={(event) => updateStory('logline', event.target.value)} /></label><label>حرفِ اصلی داستان<textarea value={editableStory.message} onChange={(event) => updateStory('message', event.target.value)} /></label><label>ظاهرِ تصویرها<input value={editableStory.visualStyle} onChange={(event) => updateStory('visualStyle', event.target.value)} /></label><label>جایی که داستان رخ می‌دهد<textarea value={editableStory.world} onChange={(event) => updateStory('world', event.target.value)} /></label><label>پایان داستان<textarea value={editableStory.ending} onChange={(event) => updateStory('ending', event.target.value)} /></label></div><details className="story-editor__beats"><summary>مسیر داستان</summary>{(['setup', 'goal', 'obstacle', 'climax', 'resolution'] as Array<keyof StoryScenario['storyBeats']>).map((key) => <label key={key}>{({ setup: 'شروع', goal: 'چیزی که قهرمان می‌خواهد', obstacle: 'مشکل اصلی', climax: 'هیجان‌انگیزترین بخش', resolution: 'پایان ماجرا' }[key])}<textarea value={editableStory.storyBeats[key]} onChange={(event) => updateBeat(key, event.target.value)} /></label>)}</details><div className="story-editor__characters">{editableStory.characters.map((character, index) => <details key={`${character.name}-${index}`}><summary>شخصیت: {character.name || 'بدون نام'}</summary>{(['name', 'description', 'personality', 'specialAbility', 'relationship', 'visualSignature', 'goal', 'voiceStyle'] as Array<keyof StoryScenario['characters'][number]>).map((key) => <label key={key}>{({ name: 'نام', description: 'ظاهر و ویژگی‌ها', personality: 'رفتار و اخلاق', specialAbility: 'تواناییِ ویژه', relationship: 'رابطه با قهرمان', visualSignature: 'نشانه‌ی ظاهریِ ثابت', goal: 'چیزی که می‌خواهد', voiceStyle: 'شیوه‌ی حرف‌زدن' }[key])}{key === 'name' ? <input value={character[key]} onChange={(event) => updateCharacter(index, key, event.target.value)} /> : <textarea value={character[key]} onChange={(event) => updateCharacter(index, key, event.target.value)} />}</label>)}</details>)}</div><div className="story-editor__scenes">{editableStory.scenes.map((scene, index) => <details key={scene.number}><summary>بخش {scene.number}: {scene.title || 'بدون عنوان'}</summary><label>عنوان بخش<input value={scene.title} onChange={(event) => updateScene(index, 'title', event.target.value)} /></label>{sceneFields.map((field) => <label key={field.key}>{field.label}<textarea rows={field.rows || 2} value={scene[field.key]} onChange={(event) => updateScene(index, field.key, event.target.value)} /></label>)}</details>)}</div><Button type="button" loading={busy} onClick={() => void saveManual()}><Icon name="check" size={17} aria-hidden="true" /> ذخیره و بررسی کیفیت</Button></section>}

      {versions.length > 1 ? <details className="story-editor__versions"><summary>نسخه‌های قبلی ({versions.length - 1})</summary><div>{versions.slice(0, -1).reverse().map((version) => <button key={version.id} type="button" onClick={() => onRestore(version)}><span>{version.label}</span><small>{new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(version.createdAt))}</small></button>)}</div></details> : null}
    </div>}
  </Dialog>;
}
