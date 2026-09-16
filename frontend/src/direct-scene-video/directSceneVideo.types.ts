export type DirectSceneSource = {
  id: string;
  number: number;
  title: string;
  description: string;
  action?: string;
  camera?: string;
  dialogue?: string;
  mood?: string;
  imageUrl?: string;
};

export type DirectSceneVideoPlanScene = {
  sourceSceneId: string;
  durationSeconds: number;
  action: string;
  camera: string;
  transition: string;
  audioDirection: string;
  videoPrompt: string;
};

export type DirectSceneVideoPlan = {
  title: string;
  summary: string;
  audioDirection: string;
  scenes: DirectSceneVideoPlanScene[];
};
