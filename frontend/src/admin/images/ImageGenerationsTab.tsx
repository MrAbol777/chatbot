import { useEffect, useState } from 'react';
import { Button, InlineMessage, TextField } from '../../design-system/components';
import type { ImageGeneration, ImageGenerationsPayload } from '../admin.types';
import { handleAdminResponse } from '../admin.types';

const IMAGE_GENERATIONS_PAGE_SIZE = 12;

export default function ImageGenerationsTab() {
  const [imageGenerations, setImageGenerations] = useState<ImageGeneration[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadImageGenerations = async (targetPage = page) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(targetPage),
      pageSize: String(IMAGE_GENERATIONS_PAGE_SIZE)
    });
    if (query.trim()) params.set('q', query.trim());
    if (status !== 'all') params.set('status', status);

    try {
      const response = await fetch(`/api/admin/image-generations?${params.toString()}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری تصاویر استودیو ناموفق بود.');
      if (!result.ok) return;
      const payload = (result.data || {}) as ImageGenerationsPayload;
      setImageGenerations(payload.items || []);
      setTotal(Number(payload.total || 0));
      setPage(Number(payload.page || targetPage));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اتصال به سرور برقرار نشد.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadImageGenerations(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / IMAGE_GENERATIONS_PAGE_SIZE));

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <h3>تصاویر ساخته‌شده در استودیوی هوش مصنوعی</h3>
          <p className="admin-note">پیگیری وضعیت درخواست‌ها، پرامپت خام کاربر، پرامپت ارسالی و فایل‌های خروجی</p>
        </div>
        <Button className="admin-action-btn" disabled={loading} onClick={() => void loadImageGenerations(page)}>
          {loading ? 'در حال بازخوانی...' : 'بازخوانی'}
        </Button>
      </div>

      <div className="admin-controls">
        <TextField
          className="admin-control-field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجوی نام کاربر، شماره یا پرامپت"
          aria-label="جستجوی تصاویر استودیو"
          fullWidth={false}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="وضعیت ساخت تصویر">
          <option value="all">همه وضعیت‌ها</option>
          <option value="COMPLETED">تکمیل‌شده</option>
          <option value="RUNNING">در حال ساخت</option>
          <option value="QUEUE">در صف انتظار</option>
          <option value="ERROR">ناموفق</option>
          <option value="CANCELLED">لغوشده</option>
        </select>
        <Button className="admin-action-btn" onClick={() => void loadImageGenerations(1)} disabled={loading}>
          اعمال فیلتر
        </Button>
      </div>

      <div className="admin-users-summary">
        <span>نمایش صفحه {page} از {totalPages}، مجموع {total} درخواست تصویر</span>
      </div>

      {error ? <InlineMessage text={error} variant="error" /> : null}

      <div className="studio-generation-grid">
        {imageGenerations.map((generation) => (
          <article className="studio-generation-card" key={generation.id}>
            <div className="studio-generation-card__image">
              {generation.imageUrl ? (
                <a href={generation.imageUrl} target="_blank" rel="noreferrer" title="مشاهده تصویر با کیفیت اصلی">
                  <img src={generation.imageUrl} alt={`خروجی تصویر برای ${generation.user.name}`} loading="lazy" />
                </a>
              ) : (
                <span>{generation.status === 'ERROR' ? 'ساخت تصویر با خطا مواجه شد' : 'تصویر در حال آماده‌سازی است'}</span>
              )}
            </div>
            <div className="studio-generation-card__meta">
              <strong>{generation.user.name || 'کاربر'}</strong>
              <span>
                {generation.user.phone || 'شماره ثبت‌نشده'}
                {generation.createdAt ? ` · ${new Date(generation.createdAt).toLocaleDateString('fa-IR')}` : ''}
              </span>
            </div>
            <div className="studio-generation-card__prompt">
              <span>پرامپت کاربر:</span>
              <p>{generation.originalPrompt || '-'}</p>
            </div>
            <div className="studio-generation-card__prompt">
              <span>پرامپت بهینه‌شده (API):</span>
              <p>{generation.apiPrompt || '-'}</p>
            </div>
            <div className="studio-generation-card__footer">
              <span>{generation.operation === 'edit' ? 'ویرایش تصویر' : 'ساخت تصویر'} · {generation.status}</span>
              {generation.model ? <span>{generation.model}</span> : null}
            </div>
          </article>
        ))}
      </div>

      {!loading && imageGenerations.length === 0 ? (
        <p className="admin-note" style={{ textAlign: 'center', marginTop: '24px' }}>تصویری با این مشخصات یافت نشد.</p>
      ) : null}

      <div className="admin-pagination">
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => void loadImageGenerations(page - 1)}
        >
          قبلی
        </Button>
        <span>صفحه {page} / {totalPages}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || page >= totalPages}
          onClick={() => void loadImageGenerations(page + 1)}
        >
          بعدی
        </Button>
      </div>
    </div>
  );
}
