import type { StudioTool } from './studio.types';

type Props = {
  tool: StudioTool;
  onOpen: () => void;
};

function ToolIcon({ toolId }: { toolId: StudioTool['id'] }) {
  return toolId === 'image' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="m6.5 16 3.8-4 2.8 2.8 1.6-1.7 2.8 2.9M15.8 9h.01" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="12.5" height="14" rx="3" />
      <path d="m16 10 4-2.2v8.4L16 14M8.5 9.2l4.2 2.8-4.2 2.8V9.2Z" />
    </svg>
  );
}

export default function StudioToolCard({ tool, onOpen }: Props) {
  const isImage = tool.id === 'image';

  return (
    <button
      type="button"
      className={`ds-card ds-card--padding-lg studio-tool-card studio-tool-card--${tool.id}`}
      onClick={onOpen}
      aria-label={`${tool.actionLabel}: ${tool.title}`}
    >
      <div className="studio-tool-card__topline" aria-hidden="true">
        <span className="studio-tool-card__type">{isImage ? 'خلق تصویر' : 'خلق ویدیو'}</span>
        <span className="studio-tool-card__index">{isImage ? '01' : '02'}</span>
      </div>
      <div className={`studio-tool-card__icon studio-tool-card__icon--${tool.id}`}>
        <ToolIcon toolId={tool.id} />
      </div>
      <div className="studio-tool-card__copy">
        <span className="studio-tool-card__status">فعال</span>
        <h2>{tool.title}</h2>
        <p>{tool.description}</p>
      </div>
      <span className="studio-tool-card__action" aria-hidden="true">
        <span>{tool.actionLabel}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
      </span>
    </button>
  );
}
