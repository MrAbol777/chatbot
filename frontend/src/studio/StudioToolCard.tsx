import type { StudioTool } from './studio.types';

type Props = {
  tool: StudioTool;
  onOpen: () => void;
};

function ToolIcon({ toolId }: { toolId: StudioTool['id'] }) {
  return toolId === 'animation' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="12.5" height="14" rx="3" />
      <path d="m16 10 4-2.2v8.4L16 14M8 9.2l4.2 2.8-4.2 2.8V9.2Z" />
      <path d="m18.1 3.2.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45.45-1.2Z" />
    </svg>
  ) : toolId === 'story' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5.5h9.5A2.5 2.5 0 0 1 18 8v10.5H7.7A2.7 2.7 0 0 1 5 15.8V6.5c0-.6.4-1 1-1Z" />
      <path d="M8 9h6M8 12h7M8 15h4" />
      <path d="m18.1 4.3.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
    </svg>
  ) : toolId === 'characters' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="8.3" r="2.4" />
      <circle cx="16.2" cy="8.3" r="2.4" />
      <path d="M3.7 18.5c.5-3 2.1-4.7 4.6-4.7s4.1 1.7 4.6 4.7M11.3 18.5c.5-3 2.1-4.7 4.6-4.7s4.1 1.7 4.6 4.7" />
      <path d="m17.7 3.2.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45.45-1.2Z" />
    </svg>
  ) : toolId === 'image' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="m6.5 16 3.8-4 2.8 2.8 1.6-1.7 2.8 2.9M15.8 9h.01" />
    </svg>
  ) : toolId === 'storyboard' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M8 8.5h8M8 12h3.5M13.5 12H16M8 15.5h8" />
      <path d="m17.3 2.8.45 1.25 1.25.45-1.25.45-.45 1.25-.45-1.25-1.25-.45 1.25-.45.45-1.25Z" />
    </svg>
  ) : toolId === 'direct-video' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="12.5" height="14" rx="3" />
      <path d="m16 10 4-2.2v8.4L16 14M7.5 9.5h4.5M7.5 12h4.5M7.5 14.5h3" />
      <path d="m18.1 3.2.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45.45-1.2Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="12.5" height="14" rx="3" />
      <path d="m16 10 4-2.2v8.4L16 14M8.5 9.2l4.2 2.8-4.2 2.8V9.2Z" />
    </svg>
  );
}

export default function StudioToolCard({ tool, onOpen }: Props) {
  const toolMeta = tool.id === 'animation'
    ? { type: 'فیلم‌سازی کامل', index: '00' }
    : tool.id === 'story'
    ? { type: 'داستان‌پردازی', index: '01' }
    : tool.id === 'characters'
      ? { type: 'طراحی شخصیت', index: '02' }
    : tool.id === 'storyboard'
      ? { type: 'صحنه‌سازی', index: '03' }
      : tool.id === 'image'
        ? { type: 'خلق تصویر', index: '04' }
      : tool.id === 'video'
        ? { type: 'خلق ویدیو', index: '05' }
        : { type: 'کارگردانی خودکار', index: '06' };

  return (
    <button
      type="button"
      className={`ds-card ds-card--padding-lg studio-tool-card studio-tool-card--${tool.id}`}
      onClick={onOpen}
      aria-label={`${tool.actionLabel}: ${tool.title}`}
    >
      <div className="studio-tool-card__topline" aria-hidden="true">
        <span className="studio-tool-card__type">{toolMeta.type}</span>
        <span className="studio-tool-card__index">{toolMeta.index}</span>
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
