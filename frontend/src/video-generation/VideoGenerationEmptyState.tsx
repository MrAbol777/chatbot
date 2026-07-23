import EmptyState from '../components/EmptyState';
import { Button } from '../design-system/components';
export function HistoryEmptyState({ retry, loading }: { retry: () => void; loading: boolean }) {
  return (
    <EmptyState
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" />
        </svg>
      }
      title="هنوز ویدیویی نساخته‌اید"
      description="پس از ثبت درخواست، وضعیت و نتیجه ویدیو در این بخش نمایش داده می‌شود."
      action={<Button type="button" variant="secondary" onClick={retry} loading={loading}>تلاش دوباره</Button>}
    />
  );
}
