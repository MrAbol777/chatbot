import type { VideoGenerationListItem } from './video-generation.types';
import { formatVideoDate, promptPreview } from './video-generation.utils';
import VideoGenerationStatus from './VideoGenerationStatus';

export default function VideoGenerationHistoryItem({ item, selected, onSelect }: { item: VideoGenerationListItem; selected: boolean; onSelect: (id: string) => void }) {
  return <button type="button" className={`video-history-item ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(item.id)} aria-pressed={selected}>
    <span className="video-history-item__top"><VideoGenerationStatus status={item.status} /><time dateTime={item.created_at}>{formatVideoDate(item.created_at)}</time></span>
    <strong>{promptPreview(item.prompt)}</strong>
    <span className="video-history-item__meta">{item.aspect_ratio || '—'} · {item.duration || '—'} · {item.quality || '—'}</span>
  </button>;
}
