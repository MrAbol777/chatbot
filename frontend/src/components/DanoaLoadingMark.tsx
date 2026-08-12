type DanoaLoadingMarkProps = {
  className?: string;
};

export default function DanoaLoadingMark({ className }: DanoaLoadingMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id="danoa-loading-mark-gradient" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#5b21b6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#danoa-loading-mark-gradient)" />
      <path d="M32 12.5 35.7 25l12.8 3.7-12.8 3.7L32 45l-3.7-12.6-12.8-3.7L28.3 25 32 12.5Z" fill="#fff" />
      <path d="m47.5 41 1.7 5.8 5.8 1.7-5.8 1.7-1.7 5.8-1.7-5.8-5.8-1.7 5.8-1.7 1.7-5.8Z" fill="#ddd6fe" />
    </svg>
  );
}
