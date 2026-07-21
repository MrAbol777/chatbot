import { Button } from '../design-system/components';
export function HistoryEmptyState({ retry, loading }: { retry: () => void; loading: boolean }) {
  return <section className="video-empty-state"><h2>هنوز ویدیویی نساخته‌اید</h2><p>پس از ثبت درخواست، وضعیت و نتیجه ویدیو در این بخش نمایش داده می‌شود.</p><Button type="button" variant="secondary" onClick={retry} loading={loading}>تلاش دوباره</Button></section>;
}
