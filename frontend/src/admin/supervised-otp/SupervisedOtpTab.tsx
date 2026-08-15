import { useEffect, useState } from 'react';
import { Button, FieldGroup, InlineMessage, TextField, useNotification } from '../../design-system/components';
import type { AdminIdentity, SupervisedOtpConfig } from '../admin.types';
import { handleAdminResponse } from '../admin.types';

const formatDateTimeLocalInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

type SupervisedOtpTabProps = {
  adminIdentity: AdminIdentity | null;
};

export default function SupervisedOtpTab({ adminIdentity }: SupervisedOtpTabProps) {
  const { notify, confirm } = useNotification();
  const [supervisedOtp, setSupervisedOtp] = useState<SupervisedOtpConfig | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    code: '',
    expires_at: '',
    max_uses: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const canManage = ['superadmin', 'admin'].includes(adminIdentity?.role || '');

  const loadSupervisedOtp = async () => {
    setMessage('');
    try {
      const response = await fetch('/api/admin/supervised-otp', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری Supervised OTP ناموفق بود.');
      if (!result.ok) return;
      const config = result.data as SupervisedOtpConfig;
      setSupervisedOtp(config);
      setForm({
        enabled: Boolean(config.enabled),
        code: '',
        expires_at: formatDateTimeLocalInput(config.expires_at),
        max_uses: config.max_uses == null ? '' : String(config.max_uses)
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'خطا در دریافت وضعیت رمز نظارتی.');
    }
  };

  useEffect(() => {
    void loadSupervisedOtp();
  }, []);

  const saveSupervisedOtp = async () => {
    if (!canManage) {
      notify.error('شما سطح دسترسی لازم برای تغییر رمز نظارتی را ندارید.', { title: 'عدم دسترسی' });
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const payload: Record<string, unknown> = {
        enabled: form.enabled,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        max_uses: form.max_uses.trim() ? Number(form.max_uses) : null
      };
      if (form.code.trim()) payload.code = form.code.trim();

      const response = await fetch('/api/admin/supervised-otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const result = await handleAdminResponse(response, 'ذخیره Supervised OTP ناموفق بود.');
      if (result.ok) {
        const config = result.data as SupervisedOtpConfig;
        setSupervisedOtp(config);
        setForm({
          enabled: Boolean(config.enabled),
          code: '',
          expires_at: formatDateTimeLocalInput(config.expires_at),
          max_uses: config.max_uses == null ? '' : String(config.max_uses)
        });
        setMessage('رمز نظارتی با موفقیت ذخیره شد.');
        notify.success('تنظیمات ذخیره شد.', { title: 'رمز نظارتی' });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'ذخیره رمز نظارتی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const resetUsedCount = async () => {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/supervised-otp/reset-used-count', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await handleAdminResponse(response, 'ریست تعداد استفاده ناموفق بود.');
      if (result.ok) {
        setSupervisedOtp(result.data);
        setMessage('شمارنده استفاده با موفقیت صفر شد.');
        notify.success('شمارنده ریست شد.', { title: 'رمز نظارتی' });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'عملیات ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const deleteSupervisedOtp = async () => {
    const allowed = await confirm({
      message: 'آیا از غیرفعال‌سازی و حذف کامل کد رمز نظارتی اطمینان دارید؟',
      confirmText: 'حذف و غیرفعال‌سازی',
      cancelText: 'انصراف',
      variant: 'danger'
    });
    if (!allowed) return;

    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/supervised-otp', {
        method: 'DELETE',
        credentials: 'include'
      });
      const result = await handleAdminResponse(response, 'حذف Supervised OTP ناموفق بود.');
      if (result.ok) {
        const config = result.data as SupervisedOtpConfig;
        setSupervisedOtp(config);
        setForm({
          enabled: Boolean(config.enabled),
          code: '',
          expires_at: '',
          max_uses: ''
        });
        setMessage('کد نظارتی حذف و غیرفعال شد.');
        notify.success('کد نظارتی حذف شد.', { title: 'رمز نظارتی' });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'حذف رمز نظارتی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const supervisedOtpStatus = supervisedOtp?.enabled ? 'فعال' : 'غیرفعال';
  const supervisedOtpHasCode = supervisedOtp?.hasCode ? 'کد در سیستم تنظیم شده است' : 'کدی ذخیره نشده';

  return (
    <div className="admin-section supervised-otp-card">
      <div className="admin-section-header">
        <div>
          <h3>مدیریت رمز نظارتی موقت (Supervised OTP)</h3>
          <p className="admin-note">امکان تعریف کد ۴ رقمی اختصاصی با تاریخ انقضا و سقف استفاده جهت ورود آزمایشی و نظارت مستقیم</p>
        </div>
        <div className="supervised-otp-card__status" style={{ textAlign: 'left' }}>
          <span style={{ fontWeight: 600, color: supervisedOtp?.enabled ? '#10b981' : '#888' }}>
            وضعیت: {supervisedOtpStatus}
          </span>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>{supervisedOtpHasCode}</div>
        </div>
      </div>

      <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', padding: '12px', marginBottom: '20px' }}>
        <strong style={{ color: '#f87171' }}>⚠️ هشدار امنیتی:</strong>
        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#fca5a5' }}>
          کد نظارتی به عنوان یک شاه‌کلید موقت عمل می‌کند. حتماً پس از پایان تست یا نظارت، آن را غیرفعال یا حذف نمایید. تمام تراکنش‌های مربوط به این کد در فایل لاگ ممیزی ثبت می‌شوند.
        </p>
      </div>

      {message ? (
        <InlineMessage
          text={message}
          variant={message.includes('موفقیت') || message.includes('شد') ? 'success' : 'error'}
        />
      ) : null}

      <FieldGroup direction="row">
        <label className="admin-control-field supervised-otp-card__toggle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
            disabled={!canManage}
          />
          <span>فعال‌سازی دسترسی نظارتی</span>
        </label>
        <TextField
          label="کد ۴ رقمی جدید"
          value={form.code}
          maxLength={4}
          inputMode="numeric"
          placeholder={supervisedOtp?.hasCode ? 'برای تغییر، کد جدید وارد کنید' : 'مثلاً 1234'}
          onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
          disabled={!canManage}
        />
        <TextField
          label="تاریخ و زمان انقضا"
          type="datetime-local"
          value={form.expires_at}
          onChange={(e) => setForm((prev) => ({ ...prev, expires_at: e.target.value }))}
          disabled={!canManage}
        />
      </FieldGroup>

      <FieldGroup direction="row">
        <TextField
          label="سقف تعداد استفاده"
          type="number"
          min="1"
          value={form.max_uses}
          placeholder="خالی یعنی نامحدود"
          onChange={(e) => setForm((prev) => ({ ...prev, max_uses: e.target.value }))}
          disabled={!canManage}
        />
        <TextField
          label="تعداد دفعات استفاده‌شده"
          value={String(supervisedOtp?.used_count ?? 0)}
          disabled
        />
        <TextField
          label="وضعیت کد در دیتابیس"
          value={supervisedOtpHasCode}
          disabled
        />
      </FieldGroup>

      {canManage ? (
        <FieldGroup direction="row" className="config-actions" style={{ marginTop: '20px' }}>
          <Button variant="secondary" onClick={() => void saveSupervisedOtp()} disabled={saving}>
            {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات رمز'}
          </Button>
          <Button variant="ghost" onClick={() => void resetUsedCount()} disabled={saving}>
            ریست شمارنده استفاده
          </Button>
          <Button variant="danger" onClick={() => void deleteSupervisedOtp()} disabled={saving || !supervisedOtp?.hasCode}>
            حذف و غیرفعال‌سازی کد
          </Button>
        </FieldGroup>
      ) : null}
    </div>
  );
}
