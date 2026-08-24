import { statusLabel } from './video-generation.constants';
import { normalizeVideoStatus } from './video-generation.utils';
import Icon from '../components/Icon';

export default function VideoGenerationStatus({ status, live = false }: { status: string; live?: boolean }) {
  const normalized = normalizeVideoStatus(status);
  const pending = !['provider_status_unknown', 'succeeded', 'failed', 'cancelled', 'expired'].includes(normalized);
  return <span className={`video-status video-status--${normalized}`} aria-live={live ? 'polite' : undefined}>{pending ? <Icon name="spinner" size={13} className="video-status__spinner" aria-hidden="true" /> : null}{statusLabel[normalized]}</span>;
}
