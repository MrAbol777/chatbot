import { useEffect, useState } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import { videoGenerationService } from './video-generation.service';
import type { VideoGenerationDetail } from './video-generation.types';

export default function VideoGenerationPlayer({ generation }: { generation: VideoGenerationDetail | null }) {
  const [prepared, setPrepared] = useState(false); const [error, setError] = useState(''); const [downloading, setDownloading] = useState(false);
  const ready = generation?.status === 'succeeded' && Boolean(generation.result);
  useEffect(() => { let active = true; const controller = new AbortController(); setPrepared(false); setError(''); if (ready && generation) videoGenerationService.prepareVideoContent(generation.id, controller.signal).then(() => { if (active) setPrepared(true); }).catch((reason: unknown) => { if (active && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'بارگذاری ویدیو ناموفق بود.'); }); return () => { active = false; controller.abort(); }; }, [generation?.id, ready]);
  if (!generation) return <section className="video-player video-player--empty"><h2>نتیجه ویدیو</h2><p>یکی از درخواست‌ها را انتخاب کنید تا جزئیات آن نمایش داده شود.</p></section>;
  if (!ready) { const failed = ['failed', 'cancelled', 'expired', 'provider_status_unknown'].includes(String(generation.status)); const safeMessage = generation.safeErrorMessage || generation.safe_error_message; return <section className="video-player video-player--empty"><h2>نتیجه ویدیو</h2><p>{failed ? safeMessage || 'ساخت این ویدیو ناموفق بود؛ نوآی رزروشده به کیف پول شما بازگشت.' : 'ویدیو پس از آماده‌شدن در این بخش قابل پخش خواهد بود.'}</p></section>; }
  const contentUrl = videoGenerationService.getVideoContentUrl(generation.id); const downloadUrl = videoGenerationService.getVideoDownloadUrl(generation.id);
  const download = async () => { setDownloading(true); setError(''); try { await videoGenerationService.prepareVideoContent(generation.id); window.location.assign(downloadUrl); } catch (reason) { setError(reason instanceof Error ? reason.message : 'دانلود ویدیو ناموفق بود.'); } finally { setDownloading(false); } };
  return <section className="video-player" aria-labelledby="video-player-title"><div className="video-section-heading"><h2 id="video-player-title">ویدیو آماده است</h2></div>{error ? <InlineMessage variant="error" text={error} /> : prepared ? <video className="video-player__media" controls preload="metadata" playsInline src={contentUrl} onError={() => setError('پخش ویدیو با خطا مواجه شد. دوباره تلاش کنید.')}>مرورگر شما از پخش ویدیو پشتیبانی نمی‌کند.</video> : <p className="video-loading" role="status">در حال آماده‌سازی پخش امن ویدیو…</p>}<Button type="button" variant="secondary" disabled={!prepared || downloading} loading={downloading} onClick={() => void download()}>دانلود ویدیو</Button></section>;
}
