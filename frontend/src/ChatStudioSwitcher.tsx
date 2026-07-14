import './ChatStudioSwitcher.css';

type ChatStudioSwitcherProps = {
  active: 'chat' | 'studio';
  onChat: () => void;
  onNewChat: () => void;
  onStudio: () => void;
};

export default function ChatStudioSwitcher({
  active,
  onChat,
  onNewChat,
  onStudio
}: ChatStudioSwitcherProps) {
  return (
    <nav
      className="chat-studio-switcher"
      aria-label="جابجایی بین چت و استودیو"
    >
      <div className="chat-studio-switcher__panel">
        <button
          type="button"
          className={`chat-studio-switcher__item${active === 'chat' ? ' is-active' : ''}`}
          onClick={onChat}
          aria-label="رفتن به چت"
          aria-current={active === 'chat' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.5 11.5c0 4.14-3.8 7.5-8.5 7.5a9.2 9.2 0 0 1-4.1-.95L3.5 19.5l1.3-3.35A7.04 7.04 0 0 1 3.5 11.5C3.5 7.36 7.3 4 12 4s8.5 3.36 8.5 7.5Z" />
            <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
          </svg>
          <span>چت</span>
        </button>
        <button
          type="button"
          className="chat-studio-switcher__new-chat"
          onClick={onNewChat}
          aria-label="شروع گفت‌وگوی جدید"
          title="گفت‌وگوی جدید"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13.5 5.5H6.75A2.75 2.75 0 0 0 4 8.25v9A2.75 2.75 0 0 0 6.75 20h9a2.75 2.75 0 0 0 2.75-2.75v-6.5" />
            <path d="m13 11 5.85-5.85a1.9 1.9 0 0 1 2.7 2.7L15.7 13.7 12 14.5z" />
            <path d="m17.5 6.35 2.15 2.15" />
          </svg>
          <small>چت جدید</small>
        </button>
        <button
          type="button"
          className={`chat-studio-switcher__item${active === 'studio' ? ' is-active' : ''}`}
          onClick={onStudio}
          aria-label="رفتن به استودیو"
          aria-current={active === 'studio' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.75A1.75 1.75 0 0 1 5.75 4h12.5A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25V5.75Z" />
            <path d="m7 16 3.2-3.2a1.2 1.2 0 0 1 1.7 0l1.45 1.45 1.25-1.25a1.2 1.2 0 0 1 1.7 0L18 14.7M15.5 8.5h.01" />
          </svg>
          <span>استودیو</span>
        </button>
      </div>
    </nav>
  );
}
