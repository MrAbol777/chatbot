import type { VideoGenerationListItem } from './video-generation.types';
import VideoGenerationHistoryItem from './VideoGenerationHistoryItem';
import { HistoryEmptyState } from './VideoGenerationEmptyState';

export default function VideoGenerationHistory({ items, selectedId, loading, error, onRetry, onSelect }: { items: VideoGenerationListItem[]; selectedId?: string; loading: boolean; error: string; onRetry: () => void; onSelect: (id: string) => void }) {
  return <section className="video-history" aria-labelledby="video-history-title"><div className="video-section-heading"><h2 id="video-history-title">تاریخچه ویدیوها</h2><span>{items.length} مورد اخیر</span></div>{loading ? <p className="video-loading" role="status">در حال دریافت تاریخچه…</p> : error ? <div><p className="video-error" role="alert">{error}</p><button type="button" className="video-link-button" onClick={onRetry}>تلاش دوباره</button></div> : items.length ? <div className="video-history__list">{items.map((item) => <VideoGenerationHistoryItem key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />)}</div> : <HistoryEmptyState retry={onRetry} loading={loading} />}</section>;
}
