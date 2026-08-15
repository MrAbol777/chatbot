import { useEffect, useState } from 'react';
import { Button, FieldGroup, InlineMessage, useNotification } from '../../design-system/components';
import type { AdminIdentity, FlaggedItem } from '../admin.types';
import { handleAdminResponse } from '../admin.types';

type ModerationTabProps = {
  adminIdentity: AdminIdentity | null;
};

export default function ModerationTab({ adminIdentity }: ModerationTabProps) {
  const { notify, confirm } = useNotification();
  const [data, setData] = useState<FlaggedItem>({ users: [], images: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canBan = ['superadmin', 'admin', 'moderator'].includes(adminIdentity?.role || '');

  const loadModerationData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/moderation/flagged', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری داده‌های نظارت ناموفق بود.');
      if (result.ok) {
        setData(result.data as FlaggedItem);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در برقراری ارتباط با سرور.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadModerationData();
  }, []);

  const handleToggleBan = async (userId: string, currentBanned: boolean) => {
    const nextBanned = !currentBanned;
    const allowed = await confirm({
      message: nextBanned ? 'آیا از مسدودسازی این کاربر اطمینان دارید؟' : 'آیا کاربر رفع مسدودیت شود؟',
      confirmText: nextBanned ? 'مسدودسازی' : 'رفع مسدودی',
      cancelText: 'انصراف',
      variant: nextBanned ? 'danger' : 'default'
    });
    if (!allowed) return;

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isBanned: nextBanned })
      });
      const result = await handleAdminResponse(response, 'تغییر وضعیت مسدودسازی ناموفق بود.');
      if (result.ok) {
        notify.success(nextBanned ? 'کاربر مسدود شد.' : 'کاربر رفع مسدودیت شد.', { title: 'مدیریت ایمنی' });
        await loadModerationData();
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'خطا در اعمال تغییرات.', { title: 'خطا' });
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-header" style={{ marginBottom: '16px' }}>
        <div>
          <h3>مرکز ایمنی، نظارت بر محتوا و فیلترهای کودک</h3>
          <p className="admin-note">بررسی حساب‌های مسدودشده، خطاهای ایمنی تولید تصویر و پایش رفتارهای پرخطر</p>
        </div>
        <Button variant="secondary" onClick={() => void loadModerationData()} disabled={loading}>
          {loading ? 'در حال بازخوانی...' : 'بازخوانی داده‌ها'}
        </Button>
      </div>

      {error ? <InlineMessage text={error} variant="error" /> : null}

      <div className="kpi-grid" style={{ marginBottom: '24px' }}>
        <div className="kpi-card kpi-card--errors">
          <div className="kpi-card__label">کاربران مسدود / مشکوک</div>
          <strong className="kpi-card__value">{data.users.length}</strong>
        </div>
        <div className="kpi-card kpi-card--api">
          <div className="kpi-card__label">درخواست‌های ناموفق استودیو</div>
          <strong className="kpi-card__value">{data.images.length}</strong>
        </div>
        <div className="kpi-card kpi-card--active">
          <div className="kpi-card__label">پایش محافظت کودک</div>
          <strong className="kpi-card__value" style={{ fontSize: '18px', color: '#10b981' }}>فعال</strong>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
        <div>
          <h4>کاربران مسدودشده و نیازمند بررسی</h4>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>نام</th>
                  <th>سن</th>
                  <th>شماره تماس</th>
                  <th>تاریخ به‌روزرسانی</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.user_id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.age}</td>
                    <td>{u.phone || 'ثبت‌نشده'}</td>
                    <td>{u.updatedAt || u.createdAt || '-'}</td>
                    <td>
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>مسدود</span>
                    </td>
                    <td>
                      <FieldGroup direction="row" className="admin-row-actions">
                        {canBan ? (
                          <Button variant="secondary" size="sm" onClick={() => void handleToggleBan(u.user_id, u.isBanned)}>
                            رفع مسدودی
                          </Button>
                        ) : null}
                      </FieldGroup>
                    </td>
                  </tr>
                ))}
                {data.users.length === 0 ? (
                  <tr>
                    <td colSpan={6}>در حال حاضر کاربری با پرچم مسدودی ثبت نشده است.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4>درخواست‌های تصویر با وضعیت خطا / لغو</h4>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>کاربر</th>
                  <th>پرامپت درخواست‌شده</th>
                  <th>وضعیت</th>
                  <th>زمان</th>
                </tr>
              </thead>
              <tbody>
                {data.images.map((img) => (
                  <tr key={img.id}>
                    <td>
                      <strong>{img.userName}</strong>
                      <div className="admin-note" style={{ fontSize: '11px' }}>{img.userPhone || img.userId}</div>
                    </td>
                    <td>
                      <span style={{ maxWidth: '350px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {img.prompt || '-'}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: img.status === 'ERROR' ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                        {img.status}
                      </span>
                    </td>
                    <td>{img.createdAt || '-'}</td>
                  </tr>
                ))}
                {data.images.length === 0 ? (
                  <tr>
                    <td colSpan={4}>خطایی در ساخت تصاویر ثبت نشده است.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
