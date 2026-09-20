export type AnimationVideoHandoff = {
  animationProjectId: string;
  storyboardWorkspaceId: string;
  storyWorkspaceId: string;
  characterWorkspaceId: string;
  scenarioVersion: string;
  characterVersion: string;
  storyboardVersion: string;
  durationSeconds: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  visualStyle: string;
  audio: string[];
};

const KEY = 'danoa:animation-maker:video-handoff:v1';

export function saveAnimationVideoHandoff(value: AnimationVideoHandoff) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Navigation remains available if storage is blocked. */ }
}

export function readAnimationVideoHandoff(): AnimationVideoHandoff | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!raw || typeof raw.animationProjectId !== 'string' || typeof raw.storyboardWorkspaceId !== 'string') return null;
    return { animationProjectId: raw.animationProjectId.slice(0, 64), storyboardWorkspaceId: raw.storyboardWorkspaceId.slice(0, 64), storyWorkspaceId: typeof raw.storyWorkspaceId === 'string' ? raw.storyWorkspaceId.slice(0, 64) : '', characterWorkspaceId: typeof raw.characterWorkspaceId === 'string' ? raw.characterWorkspaceId.slice(0, 64) : '', scenarioVersion: typeof raw.scenarioVersion === 'string' ? raw.scenarioVersion.slice(0, 64) : '', characterVersion: typeof raw.characterVersion === 'string' ? raw.characterVersion.slice(0, 64) : '', storyboardVersion: typeof raw.storyboardVersion === 'string' ? raw.storyboardVersion.slice(0, 64) : '', durationSeconds: Number.isInteger(raw.durationSeconds) ? Math.max(2, Math.min(180, raw.durationSeconds)) : 10, aspectRatio: ['16:9', '9:16', '1:1'].includes(raw.aspectRatio) ? raw.aspectRatio : '16:9', visualStyle: typeof raw.visualStyle === 'string' ? raw.visualStyle.slice(0, 180) : '', audio: Array.isArray(raw.audio) ? raw.audio.filter((item: unknown) => typeof item === 'string').slice(0, 4) : [] };
  } catch { return null; }
}
