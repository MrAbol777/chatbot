import type { SVGAttributes } from 'react';

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-up'
  | 'x-close'
  | 'chat-bubble'
  | 'chat-dots'
  | 'grid'
  | 'sidebar'
  | 'send'
  | 'sparkle'
  | 'sparkles'
  | 'mic'
  | 'stop'
  | 'search'
  | 'settings'
  | 'credit-card'
  | 'wallet'
  | 'user'
  | 'clock'
  | 'lightbulb'
  | 'file-text'
  | 'briefcase'
  | 'copy'
  | 'upload'
  | 'retry'
  | 'spinner'
  | 'attach-image'
  | 'external-link'
  | 'medal'
  | 'download'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-zoom'
  | 'info-circle'
  | 'check'
  | 'check-circle'
  | 'book'
  | 'story'
  | 'companion'
  | 'shield'
  | 'question'
  | 'plus'
  | 'minus'
  | 'family'
  | 'login'
  | 'rocket'
  | 'star'
  | 'instagram'
  | 'telegram'
  | 'linkedin'
  | 'studio-image'
  | 'studio-video'
  | 'new-chat'
  | 'gallery'
  | 'more-horizontal'
  | 'pin'
  | 'edit'
  | 'delete'
  | 'heart'
  | 'empty-chat'
  | 'empty-video';

type IconProps = {
  name: IconName;
  size?: number | string;
  className?: string;
} & Omit<SVGAttributes<SVGSVGElement>, 'name' | 'size'>;

function Icon({ name, size = 24, className = '', ...svgProps }: IconProps) {
  const commonProps = {
    viewBox: '0 0 24 24' as string,
    fill: 'none' as string,
    stroke: 'currentColor' as string,
    strokeWidth: '1.8' as string,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width: size,
    height: size,
    className,
    focusable: 'false' as const,
    ...svgProps
  };

  switch (name) {
    case 'chevron-left':
      return <svg {...commonProps}><path d="M15 18 9 12l6-6" /></svg>;

    case 'chevron-right':
      return <svg {...commonProps}><path d="m9 18 6-6-6-6" /></svg>;

    case 'chevron-down':
      return <svg {...commonProps}><path d="m6 9 6 6 6-6" /></svg>;

    case 'chevron-up':
      return <svg {...commonProps}><path d="m18 15-6-6-6 6" /></svg>;

    case 'arrow-up':
      return (
        <svg {...commonProps} strokeWidth="2.2">
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      );

    case 'x-close':
      return <svg {...commonProps}><path d="M18 6 6 18M6 6l12 12" /></svg>;

    case 'chat-bubble':
      return <svg {...commonProps}><path d="M6.5 17.5 4 20V7.7C4 5.7 5.7 4 7.7 4h8.6C18.3 4 20 5.7 20 7.7v6.1c0 2-1.7 3.7-3.7 3.7H6.5Z" /><path d="M8 9h8M8 12.3h5.6" /></svg>;

    case 'chat-dots':
      return <svg {...commonProps}><path d="M21 11.5c0 4.14-4.03 7.5-9 7.5a10.5 10.5 0 0 1-4.52-1L3 19l1.4-3.28A6.76 6.76 0 0 1 3 11.5C3 7.36 7.03 4 12 4s9 3.36 9 7.5z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></svg>;

    case 'grid':
      return <svg {...commonProps}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>;

    case 'sidebar':
      return <svg {...commonProps}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M15.5 4.5v15M7.5 8h4M7.5 12h4M7.5 16h4" /></svg>;

    case 'send':
      return <svg {...commonProps}><path d="M4.3 11.3 19.5 4.7c.9-.4 1.8.5 1.4 1.4l-6.6 15.2a1 1 0 0 1-1.9-.2l-1-5.7-5.7-1a1 1 0 0 1-.2-1.9Z" /></svg>;

    case 'sparkle':
      return <svg {...commonProps} strokeWidth="1.5"><path d="M12 3.8 13.9 9l5.3 1.9-5.3 1.9L12 18l-1.9-5.2-5.3-1.9L10.1 9 12 3.8Z" /><path d="m18.2 15.7.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z" /></svg>;

    case 'sparkles':
      return (
        <svg {...commonProps} strokeWidth="1.6">
          <path d="m12 3 1.9 4.8 4.8 1.9-4.8 1.9L12 16.4l-1.9-4.8-4.8-1.9 4.8-1.9L12 3Z" />
          <path d="M18.5 14.5 19.5 17l2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
        </svg>
      );

    case 'mic':
      return (
        <svg {...commonProps} strokeWidth="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      );

    case 'stop':
      return <svg {...commonProps}><rect x="7" y="7" width="10" height="10" rx="2" /></svg>;

    case 'search':
      return <svg {...commonProps}><path d="M21 21l-5.2-5.2m1.7-4.55a6.25 6.25 0 1 1-12.5 0 6.25 6.25 0 0 1 12.5 0z" /></svg>;

    case 'settings':
      return <svg {...commonProps}><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.07a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.04 14H3a2 2 0 0 1 0-4h.04A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.04V3a2 2 0 0 1 4 0v.04a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.23.63.81 1 1.56 1H21a2 2 0 0 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15z" /></svg>;

    case 'credit-card':
      return <svg {...commonProps}><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3z" /></svg>;

    case 'wallet':
      return (
        <svg {...commonProps}>
          <path d="M19 7V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2" />
          <rect x="15" y="7" width="7" height="10" rx="2" />
          <circle cx="18.5" cy="12" r="1" />
        </svg>
      );

    case 'user':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="4" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );

    case 'clock':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );

    case 'lightbulb':
      return (
        <svg {...commonProps}>
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-5 11.9c.7.7 1 1.6 1 2.6V17h8v-.5c0-1 .3-1.9 1-2.6A7 7 0 0 0 12 2Z" />
        </svg>
      );

    case 'file-text':
      return (
        <svg {...commonProps}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );

    case 'briefcase':
      return (
        <svg {...commonProps}>
          <rect x="3" y="7" width="18" height="14" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M3 13a20 20 0 0 0 18 0" />
        </svg>
      );

    case 'copy':
      return <svg {...commonProps}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;

    case 'upload':
      return <svg {...commonProps}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>;

    case 'retry':
      return <svg {...commonProps}><path d="M20 11a8 8 0 1 0-2.35 5.65M20 5v6h-6" /></svg>;

    case 'spinner':
      return <svg {...commonProps} strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>;

    case 'attach-image':
      return <svg {...commonProps}><path d="M4 16l4.6-4.6a2 2 0 0 1 2.8 0L16 16m-2-2 1.6-1.6a2 2 0 0 1 2.8 0L20 14" /><path d="M14 8h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" /></svg>;

    case 'external-link':
      return <svg {...commonProps}><path d="M14 4h6v6" /><path d="M10 14 20 4" /><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" /></svg>;

    case 'medal':
      return <svg {...commonProps}><path d="M8 3h8l-1.6 4.2a6 6 0 1 1-4.8 0L8 3Z" /><path d="M12 9.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3.9-1.8Z" /><path d="M9 16.7V22l3-1.8 3 1.8v-5.3" /></svg>;

    case 'download':
      return <svg {...commonProps}><path d="M12 15l-4-4h3V4h2v7h3l-4 4ZM5 19v2h14v-2H5Z" /></svg>;

    case 'zoom-in':
      return <svg {...commonProps}><path d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5h-2Z" /></svg>;

    case 'zoom-out':
      return <svg {...commonProps}><path d="M5 11v2h14v-2H5Z" /></svg>;

    case 'reset-zoom':
      return <svg {...commonProps}><path d="M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm8-5v5l3 3" /></svg>;

    case 'info-circle':
      return <svg {...commonProps}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" /></svg>;

    case 'check':
      return <svg {...commonProps}><path d="m6 12.5 3.2 3.2L18 7.3" /></svg>;

    case 'check-circle':
      return <svg {...commonProps}><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.2 12.8-3.6-3.6 1.4-1.4 2.2 2.2 4.8-4.8 1.4 1.4-6.2 6.2Z" /></svg>;

    case 'book':
      return <svg {...commonProps}><path d="M5 5.7c0-1 .8-1.7 1.8-1.5 1.7.2 3.4.8 5.2 1.8v13.2c-1.8-1-3.5-1.6-5.2-1.8A1.6 1.6 0 0 1 5 15.8V5.7Z" /><path d="M19 5.7c0-1-.8-1.7-1.8-1.5-1.7.2-3.4.8-5.2 1.8v13.2c1.8-1 3.5-1.6 5.2-1.8a1.6 1.6 0 0 0 1.8-1.6V5.7Z" /><path d="M8 8.2h1.5M8 11h1.5M16 8.2h-1.5M16 11h-1.5" /></svg>;

    case 'story':
      return <svg {...commonProps}><path d="M6 5.5h9.5A2.5 2.5 0 0 1 18 8v10.5H7.7A2.7 2.7 0 0 1 5 15.8V6.5c0-.6.4-1 1-1Z" /><path d="M8 9h6M8 12h7M8 15h4" /><path d="M18 8.2h.7c.7 0 1.3.6 1.3 1.3v7.2c0 1-.8 1.8-1.8 1.8H18" /></svg>;

    case 'companion':
      return <svg {...commonProps}><path d="M12 20s-7-3.9-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 16.1 12 20 12 20Z" /><path d="M9 11.4c.6.7 1.5 1.1 3 1.1s2.4-.4 3-1.1" /></svg>;

    case 'shield':
      return <svg {...commonProps}><path d="M12 3.5 19 6v5.4c0 4.1-2.8 7.8-7 9.1-4.2-1.3-7-5-7-9.1V6l7-2.5Z" /><path d="m8.8 12.2 2.1 2.1 4.5-4.7" /></svg>;

    case 'question':
      return <svg {...commonProps}><circle cx="12" cy="12" r="8" /><path d="M9.8 9.4a2.4 2.4 0 1 1 3.4 2.2c-.9.4-1.2.9-1.2 1.7" /><path d="M12 16.7h.1" /></svg>;

    case 'plus':
      return <svg {...commonProps}><path d="M12 6v12M6 12h12" /></svg>;

    case 'minus':
      return <svg {...commonProps}><path d="M6 12h12" /></svg>;

    case 'family':
      return <svg {...commonProps}><circle cx="8" cy="8" r="2.2" /><circle cx="16" cy="8" r="2.2" /><circle cx="12" cy="13" r="2" /><path d="M4.8 18.5c.4-2.5 2-3.8 4.4-3.8M19.2 18.5c-.4-2.5-2-3.8-4.4-3.8M8.2 20c.4-2.2 1.7-3.2 3.8-3.2s3.4 1 3.8 3.2" /></svg>;

    case 'login':
      return <svg {...commonProps}><path d="M10.5 7.2 15.3 12l-4.8 4.8" /><path d="M4 12h11" /><path d="M14 5h3.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19H14" /></svg>;

    case 'rocket':
      return <svg {...commonProps}><path d="M13.7 4.4c2.2-.9 4.5-.8 5.9-.5.3 1.4.4 3.7-.5 5.9-.9 2.3-2.8 4.2-5.7 5.7l-4.9-4.9c1.5-2.9 3.4-4.8 5.2-6.2Z" /><path d="M9.4 10.1 6 10.7 4.3 14l4.2-.5M13.9 14.6l-.5 4.2 3.3-1.7.6-3.4" /><circle cx="15.4" cy="7.9" r="1.4" /></svg>;

    case 'star':
      return <svg {...commonProps}><path d="m12 4 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5-3.6-3.5 5-.7L12 4Z" /></svg>;

    case 'instagram':
      return <svg {...commonProps}><rect x="5" y="5" width="14" height="14" rx="4" /><circle cx="12" cy="12" r="3.2" /><path d="M16.5 7.7h.1" /></svg>;

    case 'telegram':
      return <svg {...commonProps}><path d="M20 5 4.8 11.2c-.8.3-.8 1.4.1 1.6l3.8 1.1 1.5 4.5c.3.8 1.4.9 1.8.2l2.2-3.1 4 2.8c.7.5 1.6.1 1.8-.8L22 6.5c.2-1-.9-1.8-2-1.5Z" /><path d="m8.8 13.8 8-5.1-5.7 6.7" /></svg>;

    case 'linkedin':
      return <svg {...commonProps}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 10.5V16M8 8h.1M12 16v-5.4M12 13.1c0-1.7 1-2.7 2.4-2.7 1.5 0 2.6 1 2.6 3V16" /></svg>;

    case 'studio-image':
      return <svg {...commonProps}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="m6.5 16 3.8-4 2.8 2.8 1.6-1.7 2.8 2.9M15.8 9h.01" /></svg>;

    case 'studio-video':
      return <svg {...commonProps}><rect x="3.5" y="5" width="12.5" height="14" rx="3" /><path d="m16 10 4-2.2v8.4L16 14M8.5 9.2l4.2 2.8-4.2 2.8V9.2Z" /></svg>;

    case 'new-chat':
      return <svg {...commonProps}><path d="M13.5 5.5H6.75A2.75 2.75 0 0 0 4 8.25v9A2.75 2.75 0 0 0 6.75 20h9a2.75 2.75 0 0 0 2.75-2.75v-6.5" /><path d="m13 11 5.85-5.85a1.9 1.9 0 0 1 2.7 2.7L15.7 13.7 12 14.5z" /><path d="m17.5 6.35 2.15 2.15" /></svg>;

    case 'gallery':
      return <svg {...commonProps}><path d="M4 5.75A1.75 1.75 0 0 1 5.75 4h12.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25V5.75Z" /><path d="m7 16 3.2-3.2a1.2 1.2 0 0 1 1.7 0l1.45 1.45 1.25-1.25a1.2 1.2 0 0 1 1.7 0L18 14.7M15.5 8.5h.01" /></svg>;

    case 'more-horizontal':
      return <svg {...commonProps} strokeWidth="2.5"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>;

    case 'pin':
      return <svg {...commonProps} strokeWidth="1.6"><path d="M15.5 3H9a1 1 0 0 0-1 1v6.5L5.5 14v1h13.5v-1L16.5 10.5V4a1 1 0 0 0-1-1Z" /><path d="M10 3v7.5L7.5 14M14 3v7.5l2.5 3.5" /></svg>;

    case 'edit':
      return <svg {...commonProps}><path d="M8 17.5 6.5 19l-1.5-.5.5-1.5L17 5.5a1.5 1.5 0 0 1 2 2L8 17.5Z" /><path d="M15.5 6.5 17.5 8.5" /></svg>;

    case 'delete':
      return <svg {...commonProps}><path d="M5 6.5h14M8.5 6.5V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.5M9.5 10v6a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-6" /></svg>;

    case 'heart':
      return <svg {...commonProps}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>;

    case 'empty-chat':
      return <svg {...commonProps}><path d="M6.5 17.5 4 20V7.7C4 5.7 5.7 4 7.7 4h8.6C18.3 4 20 5.7 20 7.7v6.1c0 2-1.7 3.7-3.7 3.7H6.5Z" /><path d="M8 9h8M8 12.3h5.6" /></svg>;

    case 'empty-video':
      return <svg {...commonProps}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg>;

    default:
      return null;
  }
}

export default Icon;
