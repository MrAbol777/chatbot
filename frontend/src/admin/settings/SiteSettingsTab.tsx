import { useEffect, useState } from 'react';
import { Button, FieldGroup, InlineMessage, TextAreaField, TextField, useNotification } from '../../design-system/components';
import type { AdminIdentity, SiteSettingsPayload } from '../admin.types';
import { handleAdminResponse } from '../admin.types';

const VISION_MODE_OPTIONS = ['economy', 'balanced', 'accurate', 'pro'];

const VISION_DEFAULT_SYSTEM_PROMPT =
  'You are a professional image understanding engine for a Persian child-friendly AI product.\n\nAnalyze the provided image accurately. Do not guess beyond visible evidence. If something is uncertain, say it is uncertain.\n\nReturn the answer in Persian unless the user asks otherwise.';

type SiteSettingsTabProps = {
  adminIdentity: AdminIdentity | null;
};

export default function SiteSettingsTab({ adminIdentity }: SiteSettingsTabProps) {
  const { notify, confirm } = useNotification();
  const [siteSettings, setSiteSettings] = useState<SiteSettingsPayload | null>(null);
  const [siteSettingsSaving, setSiteSettingsSaving] = useState(false);
  const [siteSettingsMessage, setSiteSettingsMessage] = useState('');

  // Vision tests
  const [visionTestPrompt, setVisionTestPrompt] = useState('این عکس رو دقیق توضیح بده');
  const [visionTestFile, setVisionTestFile] = useState<File | null>(null);
  const [visionTestResult, setVisionTestResult] = useState<any>(null);
  const [visionTestMessage, setVisionTestMessage] = useState('');
  const [visionTestLoading, setVisionTestLoading] = useState(false);

  // Image refiner tests
  const [imageTestPrompt, setImageTestPrompt] = useState('یک موز آبی کارتونی، پس‌زمینه سفید ساده');
  const [imageTestResult, setImageTestResult] = useState<any>(null);
  const [imageTestMessage, setImageTestMessage] = useState('');
  const [imageTestLoading, setImageTestLoading] = useState(false);

  const canEdit = ['superadmin', 'admin', 'developer'].includes(adminIdentity?.role || '');

  const loadSiteSettings = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری تنظیمات سایت ناموفق بود.');
      if (result.ok) setSiteSettings(result.data);
    } catch (err) {
      setSiteSettingsMessage(err instanceof Error ? err.message : 'خطا در دریافت تنظیمات سایت.');
    }
  };

  useEffect(() => {
    void loadSiteSettings();
  }, []);

  const updateSiteSetting = (key: string, value: any) => {
    setSiteSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          [key]: value
        }
      };
    });
  };

  const saveSiteSettings = async () => {
    if (!siteSettings) return;
    setSiteSettingsSaving(true);
    setSiteSettingsMessage('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(siteSettings.settings)
      });
      const result = await handleAdminResponse(response, 'ذخیره تنظیمات سایت ناموفق بود.');
      if (result.ok) {
        setSiteSettings(result.data);
        setSiteSettingsMessage('تنظیمات سایت با موفقیت ذخیره شد.');
        notify.success('تنظیمات با موفقیت ذخیره شد.', { title: 'تنظیمات سایت' });
      }
    } catch (err) {
      setSiteSettingsMessage(err instanceof Error ? err.message : 'ذخیره تنظیمات سایت ناموفق بود.');
    } finally {
      setSiteSettingsSaving(false);
    }
  };

  const runVisionDryRun = async () => {
    setVisionTestLoading(true);
    setVisionTestMessage('');
    setVisionTestResult(null);
    try {
      const response = await fetch('/api/admin/vision/test-dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: visionTestPrompt, settings: siteSettings?.settings || {} })
      });
      const result = await handleAdminResponse(response, 'Dry-run خواندن تصویر ناموفق بود.');
      if (result.ok) {
        setVisionTestResult(result.data);
        setVisionTestMessage('Dry-run خواندن تصویر با موفقیت ساخته شد.');
      }
    } catch (err) {
      setVisionTestMessage(err instanceof Error ? err.message : 'Dry-run ناموفق بود.');
    } finally {
      setVisionTestLoading(false);
    }
  };

  const runVisionLiveTest = async () => {
    if (!visionTestFile) {
      setVisionTestMessage('برای تست واقعی Vision یک تصویر انتخاب کنید.');
      return;
    }
    const allowed = await confirm({
      message: 'تست واقعی Vision اعتبار API مصرف می‌کند. آیا ادامه می‌دهید؟',
      confirmText: 'اجرای تست',
      cancelText: 'انصراف',
      variant: 'danger'
    });
    if (!allowed) return;

    setVisionTestLoading(true);
    setVisionTestMessage('');
    setVisionTestResult(null);
    try {
      const formData = new FormData();
      formData.append('image', visionTestFile);
      formData.append('prompt', visionTestPrompt);
      formData.append('settings', JSON.stringify(siteSettings?.settings || {}));
      const response = await fetch('/api/admin/vision/test-live', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const result = await handleAdminResponse(response, 'تست واقعی Vision ناموفق بود.');
      if (result.ok) {
        setVisionTestResult(result.data);
        setVisionTestMessage('تست واقعی با موفقیت انجام شد.');
      }
    } catch (err) {
      setVisionTestMessage(err instanceof Error ? err.message : 'تست واقعی ناموفق بود.');
    } finally {
      setVisionTestLoading(false);
    }
  };

  const runImageDryRun = async () => {
    setImageTestLoading(true);
    setImageTestMessage('');
    setImageTestResult(null);
    try {
      const response = await fetch('/api/admin/image-prompt-refiner/test-dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: imageTestPrompt, settings: siteSettings?.settings || {} })
      });
      const result = await handleAdminResponse(response, 'Dry-run ساخت تصویر ناموفق بود.');
      if (result.ok) {
        setImageTestResult(result.data);
        setImageTestMessage('Dry-run با موفقیت انجام شد.');
      }
    } catch (err) {
      setImageTestMessage(err instanceof Error ? err.message : 'Dry-run ناموفق بود.');
    } finally {
      setImageTestLoading(false);
    }
  };

  return (
    <div className="admin-section config-panel">
      <div className="admin-section-header">
        <div>
          <h3>تنظیمات سیستم و پیکربندی ماژول‌های AI</h3>
          <p className="admin-note">کنترل پارامترهای موتور درک تصویر (Vision)، بهینه‌ساز پرامپت، روتینگ قصد کاربر و محدودیت‌های آپلود</p>
        </div>
        {canEdit ? (
          <Button onClick={() => void saveSiteSettings()} disabled={siteSettingsSaving}>
            {siteSettingsSaving ? 'در حال ذخیره...' : 'ذخیره تمام تنظیمات'}
          </Button>
        ) : null}
      </div>

      {siteSettingsMessage ? (
        <InlineMessage
          text={siteSettingsMessage}
          variant={siteSettingsMessage.includes('موفقیت') ? 'success' : 'error'}
        />
      ) : null}

      {siteSettings ? (
        <>
          <div className="admin-card-box">
            <h4>آپلود فایل و تصاویر</h4>
            <FieldGroup direction="row">
              <TextField
                label="حداکثر حجم عکس (MB)"
                type="number"
                value={String(siteSettings.settings['upload.image.max_size_mb'] ?? 5)}
                onChange={(e) => updateSiteSetting('upload.image.max_size_mb', Number(e.target.value))}
                disabled={!canEdit}
              />
              <TextField
                label="حداکثر تعداد عکس همزمان"
                type="number"
                value={String(siteSettings.settings['upload.image.max_files'] ?? 5)}
                onChange={(e) => updateSiteSetting('upload.image.max_files', Number(e.target.value))}
                disabled={!canEdit}
              />
            </FieldGroup>
          </div>

          <div className="admin-card-box">
            <h4>موتور درک و تحلیل تصویر (Vision)</h4>
            <FieldGroup direction="row">
              <label className="admin-select-field">
                <span>حالت کاری (Mode)</span>
                <select
                  value={String(siteSettings.settings['ai.vision.mode'] || 'balanced')}
                  onChange={(e) => updateSiteSetting('ai.vision.mode', e.target.value)}
                  disabled={!canEdit}
                >
                  {VISION_MODE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === 'economy' ? 'اقتصادی' : opt === 'balanced' ? 'متعادل' : opt === 'accurate' ? 'دقیق' : 'Pro'}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                label="مدل پیش‌فرض Vision"
                value={String(siteSettings.settings['ai.vision.default_model'] ?? 'gemini-2.5-flash')}
                onChange={(e) => updateSiteSetting('ai.vision.default_model', e.target.value)}
                disabled={!canEdit}
              />
              <TextField
                label="تایم‌اوت (ms)"
                type="number"
                value={String(siteSettings.settings['ai.vision.timeout_ms'] ?? 30000)}
                onChange={(e) => updateSiteSetting('ai.vision.timeout_ms', Number(e.target.value))}
                disabled={!canEdit}
              />
            </FieldGroup>

            <TextAreaField
              label="سیستم پرامپت Vision"
              rows={4}
              value={String(siteSettings.settings['ai.vision.system_prompt'] ?? VISION_DEFAULT_SYSTEM_PROMPT)}
              onChange={(e) => updateSiteSetting('ai.vision.system_prompt', e.target.value)}
              disabled={!canEdit}
            />

            <div className="admin-card-box" style={{ marginTop: '16px', background: 'rgba(0,0,0,0.25)' }}>
              <h5 style={{ margin: '0 0 10px 0' }}>ابزار تست و ارزیابی Vision</h5>
              <FieldGroup direction="row">
                <TextField
                  label="پرامپت تست"
                  value={visionTestPrompt}
                  onChange={(e) => setVisionTestPrompt(e.target.value)}
                />
                <label className="admin-control-field">
                  <span>تصویر تست</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setVisionTestFile(e.target.files?.[0] || null)} />
                </label>
                <Button onClick={() => void runVisionDryRun()} disabled={visionTestLoading}>
                  تست Dry-run
                </Button>
                <Button variant="secondary" onClick={() => void runVisionLiveTest()} disabled={visionTestLoading}>
                  تست Live
                </Button>
              </FieldGroup>
              {visionTestMessage ? (
                <InlineMessage text={visionTestMessage} variant={visionTestMessage.includes('موفقیت') ? 'success' : 'error'} />
              ) : null}
              {visionTestResult ? (
                <div style={{ marginTop: '12px', padding: '10px', background: '#0f172a', borderRadius: '6px', fontSize: '13px' }}>
                  <strong>پاسخ مدل:</strong>
                  <p style={{ margin: '6px 0 0 0', whiteSpace: 'pre-wrap' }}>{visionTestResult.reply || visionTestResult.model || JSON.stringify(visionTestResult)}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="admin-card-box">
            <h4>بهینه‌ساز پرامپت و محافظت کودک (Prompt Refiner)</h4>
            <FieldGroup direction="row">
              <label className="admin-select-field">
                <span>وضعیت بهینه‌ساز</span>
                <select
                  value={String(Boolean(siteSettings.settings['ai.image.prompt_refiner.enabled'] ?? true))}
                  onChange={(e) => updateSiteSetting('ai.image.prompt_refiner.enabled', e.target.value === 'true')}
                  disabled={!canEdit}
                >
                  <option value="true">فعال</option>
                  <option value="false">غیرفعال</option>
                </select>
              </label>
              <label className="admin-select-field">
                <span>محافظت از کودک (Child Guard)</span>
                <select
                  value={String(Boolean(siteSettings.settings['ai.image.prompt_refiner.child_safety_guard'] ?? true))}
                  onChange={(e) => updateSiteSetting('ai.image.prompt_refiner.child_safety_guard', e.target.value === 'true')}
                  disabled={!canEdit}
                >
                  <option value="true">فعال (اعمال قوانین سخت‌گیرانه کودک)</option>
                  <option value="false">غیرفعال</option>
                </select>
              </label>
            </FieldGroup>

            <div className="admin-card-box" style={{ marginTop: '16px', background: 'rgba(0,0,0,0.25)' }}>
              <h5 style={{ margin: '0 0 10px 0' }}>ابزار تست بهینه‌ساز پرامپت</h5>
              <FieldGroup direction="row">
                <TextField
                  label="پرامپت خام کاربر"
                  value={imageTestPrompt}
                  onChange={(e) => setImageTestPrompt(e.target.value)}
                />
                <Button onClick={() => void runImageDryRun()} disabled={imageTestLoading}>
                  ارزیابی بهینه‌سازی
                </Button>
              </FieldGroup>
              {imageTestMessage ? (
                <InlineMessage text={imageTestMessage} variant={imageTestMessage.includes('موفقیت') ? 'success' : 'error'} />
              ) : null}
              {imageTestResult ? (
                <div style={{ marginTop: '12px', padding: '10px', background: '#0f172a', borderRadius: '6px', fontSize: '13px' }}>
                  <strong>پرامپت نهایی ارسالی به موتور تصویر:</strong>
                  <p style={{ margin: '6px 0', color: '#38bdf8' }}>{imageTestResult.finalPrompt || imageTestResult.refinedPrompt || '-'}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="admin-card-box">
            <h4>ورود، ثبت‌نام و سن قانونی</h4>
            <FieldGroup direction="row">
              <TextField
                label="اعتبار کد OTP (ثانیه)"
                type="number"
                value={String(siteSettings.settings['auth.otp.expire_seconds'] ?? 120)}
                onChange={(e) => updateSiteSetting('auth.otp.expire_seconds', Number(e.target.value))}
                disabled={!canEdit}
              />
              <TextField
                label="فاصله مجاز ارسال مجدد (ms)"
                type="number"
                value={String(siteSettings.settings['auth.otp.resend_cooldown_ms'] ?? 60000)}
                onChange={(e) => updateSiteSetting('auth.otp.resend_cooldown_ms', Number(e.target.value))}
                disabled={!canEdit}
              />
              <TextField
                label="حداقل سن مجاز"
                type="number"
                value={String(siteSettings.settings['auth.validation.age_min'] ?? 8)}
                onChange={(e) => updateSiteSetting('auth.validation.age_min', Number(e.target.value))}
                disabled={!canEdit}
              />
              <TextField
                label="حداکثر سن مجاز"
                type="number"
                value={String(siteSettings.settings['auth.validation.age_max'] ?? 18)}
                onChange={(e) => updateSiteSetting('auth.validation.age_max', Number(e.target.value))}
                disabled={!canEdit}
              />
            </FieldGroup>
          </div>
        </>
      ) : (
        <InlineMessage text="در حال بارگذاری تنظیمات سایت..." variant="help" />
      )}
    </div>
  );
}
