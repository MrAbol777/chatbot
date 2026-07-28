import type { VideoGenerationDetail, VideoGenerationListItem } from './video-generation.types';
import { formatVideoDate, promptPreview } from './video-generation.utils';
import { HistoryEmptyState } from './VideoGenerationEmptyState';
import VideoGenerationPlayer from './VideoGenerationPlayer';
import VideoGenerationStatus from './VideoGenerationStatus';

type Props = {
  active: VideoGenerationDetail | null;
  error: string;
  items: VideoGenerationListItem[];
  loading: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
};

export default function VideoGenerationGallery({ active, error, items, loading, onRetry, onSelect, selectedId }: Props) {
  return <section className="video-gallery" aria-labelledby="video-gallery-title">
    <header className="video-gallery__header">
      <div><p>کتابخانه شخصی</p><h2 id="video-gallery-title">ویدیوهای من</h2><span>{items.length} ویدیو در گالری</span></div>
      <button type="button" className="video-gallery__refresh" onClick={onRetry} disabled={loading}>دریافت دوباره</button>
    </header>
    {error ? <div className="video-gallery__error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>تلاش دوباره</button></div> : loading ? <p className="video-loading" role="status">در حال دریافت ویدیوها…</p> : items.length ? <>
      <div className="video-gallery__grid" aria-label="گالری ویدیوها">
        {items.map((item) => <button key={item.id} type="button" className={`video-gallery-card ${item.id === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(item.id)} aria-pressed={item.id === selectedId}>
          <span className="video-gallery-card__visual" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M18 12h28a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6Zm9 13v14l12-7-12-7Z" /></svg><i /></span>
          <span className="video-gallery-card__top"><VideoGenerationStatus status={item.status} /><time dateTime={item.created_at}>{formatVideoDate(item.created_at)}</time></span>
          <strong>{promptPreview(item.prompt)}</strong>
          <span className="video-gallery-card__meta">{item.aspect_ratio || '—'} · {item.duration ? `${item.duration} ثانیه` : '—'}</span>
        </button>)}
      </div>
      {active ? <div className="video-gallery__preview"><VideoGenerationPlayer generation={active} /></div> : null}
    </> : <HistoryEmptyState retry={onRetry} loading={loading} />}
  </section>;
}
