import { useEffect, useState } from 'react';
import { Button, FieldGroup, InlineMessage, TextAreaField, TextField, useNotification } from '../../design-system/components';
import type { AdminIdentity, PromptVersion } from '../admin.types';
import { handleAdminResponse } from '../admin.types';
import PromptDiffViewer from './PromptDiffViewer';

type ConfigTabProps = {
  adminIdentity: AdminIdentity | null;
};

export default function ConfigTab({ adminIdentity }: ConfigTabProps) {
  const { notify, confirm } = useNotification();
  const [config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptNote, setPromptNote] = useState('');
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const [systemPromptSaving, setSystemPromptSaving] = useState(false);
  const [systemPromptMessage, setSystemPromptMessage] = useState('');

  const [history, setHistory] = useState<PromptVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [diffVersion, setDiffVersion] = useState<PromptVersion | null>(null);

  const canEdit = ['superadmin', 'admin', 'developer'].includes(adminIdentity?.role || '');

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      const response = await fetch('/api/admin/config', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری تنظیمات ناموفق بود.');
      if (result.ok) setConfig(result.data);
    } catch {
      setConfigMessage('خطا در بارگذاری پیکربندی سیستم.');
    } finally {
      setConfigLoading(false);
    }
  };

  const loadSystemPrompt = async () => {
    setSystemPromptLoading(true);
    setSystemPromptMessage('');
    try {
      const response = await fetch('/api/admin/config/system-prompt', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'خواندن سیستم پرامپت ناموفق بود.');
      if (result.ok) {
        setSystemPrompt(typeof result.data.systemPrompt === 'string' ? result.data.systemPrompt : '');
      }
    } catch (err) {
      setSystemPromptMessage(err instanceof Error ? err.message : 'خواندن سیستم پرامپت ناموفق بود.');
    } finally {
      setSystemPromptLoading(false);
    }
  };

  const loadPromptHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch('/api/admin/config/system-prompt/history', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'دریافت تاریخچه پرامپت ناموفق بود.');
      if (result.ok && Array.isArray(result.data?.items)) {
        setHistory(result.data.items as PromptVersion[]);
      }
    } catch {
      /* ignore */
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    void loadSystemPrompt();
    void loadPromptHistory();
  }, []);

  const saveConfig = async () => {
    if (!config) return;
    setConfigSaving(true);
    setConfigMessage('');
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config)
      });
      const result = await handleAdminResponse(response, 'ذخیره تنظیمات ناموفق بود.');
      if (result.ok) {
        setConfigMessage('تنظیمات با موفقیت ذخیره شد.');
        notify.success('تنظیمات ذخیره شد.', { title: 'پیکربندی سیستم' });
      }
    } catch (err) {
      setConfigMessage(err instanceof Error ? err.message : 'ذخیره تنظیمات ناموفق بود.');
    } finally {
      setConfigSaving(false);
    }
  };

  const saveSystemPrompt = async () => {
    if (!systemPrompt.trim()) {
      setSystemPromptMessage('سیستم پرامپت نمی‌تواند خالی باشد.');
      return;
    }

    setSystemPromptSaving(true);
    setSystemPromptMessage('');
    try {
      const response = await fetch('/api/admin/config/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ systemPrompt, note: promptNote })
      });
      const result = await handleAdminResponse(response, 'ذخیره سیستم پرامپت ناموفق بود.');
      if (result.ok) {
        setSystemPromptMessage(result.data.message || 'پرامپت با موفقیت به‌روزرسانی و نسخه‌بندی شد.');
        setPromptNote('');
        notify.success('پرامپت به‌روزرسانی شد.', { title: 'سیستم پرامپت' });
        await loadPromptHistory();
      }
    } catch (err) {
      setSystemPromptMessage(err instanceof Error ? err.message : 'ذخیره سیستم پرامپت ناموفق بود.');
    } finally {
      setSystemPromptSaving(false);
    }
  };

  const rollbackPrompt = async (version: PromptVersion) => {
    const allowed = await confirm({
      message: `آیا مایلید پرامپت سیستم به نسخه ${version.version} (ثبت‌شده در ${version.createdAt}) بازگردانی شود؟`,
      confirmText: 'بازگردانی (Rollback)',
      cancelText: 'انصراف',
      variant: 'danger'
    });
    if (!allowed) return;

    setSystemPromptSaving(true);
    try {
      const response = await fetch('/api/admin/config/system-prompt/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ versionId: version.id })
      });
      const result = await handleAdminResponse(response, 'بازگردانی پرامپت ناموفق بود.');
      if (result.ok) {
        if (result.data.systemPrompt) {
          setSystemPrompt(result.data.systemPrompt);
        }
        notify.success(`پرامپت به نسخه ${version.version} بازگردانده شد.`, { title: 'بازگردانی پرامپت' });
        await loadPromptHistory();
      }
    } catch (err) {
      setSystemPromptMessage(err instanceof Error ? err.message : 'بازگردانی ناموفق بود.');
    } finally {
      setSystemPromptSaving(false);
    }
  };

  return (
    <div className="admin-section config-panel">
      <h3>پیکربندی سیستم</h3>
      <p className="admin-note">تنظیمات کلی مدل، تایم‌اوت‌ها و رفتار دستیار هوش مصنوعی</p>

      {config ? (
        <div style={{ marginBottom: '24px' }}>
          <FieldGroup direction="row">
            <TextField
              label="مدل پیش‌فرض چت"
              value={config.model || ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              disabled={!canEdit}
              helperText="نام مدل مورد استفاده در پاسخ‌دهی متنی"
            />
            <TextField
              label="تایم‌اوت درخواست (ms)"
              type="number"
              value={String(config.timeoutMs || 30000)}
              onChange={(e) => setConfig({ ...config, timeoutMs: Number(e.target.value) })}
              disabled={!canEdit}
              helperText="حداکثر زمان انتظار برای پاسخ مدل"
            />
          </FieldGroup>

          <h4 style={{ marginTop: '16px' }}>قابلیت‌های فعال</h4>
          <FieldGroup direction="row" className="config-flags">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(config.features?.voiceInput)}
                onChange={(e) => setConfig({ ...config, features: { ...config.features, voiceInput: e.target.checked } })}
                disabled={!canEdit}
              />
              ورودی صوتی (voiceInput)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(config.features?.quickChips)}
                onChange={(e) => setConfig({ ...config, features: { ...config.features, quickChips: e.target.checked } })}
                disabled={!canEdit}
              />
              چیپ‌های سریع (quickChips)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(config.features?.practiceMode)}
                onChange={(e) => setConfig({ ...config, features: { ...config.features, practiceMode: e.target.checked } })}
                disabled={!canEdit}
              />
              حالت تمرین (practiceMode)
            </label>
          </FieldGroup>

          {canEdit ? (
            <FieldGroup direction="row" className="config-actions" style={{ marginTop: '16px' }}>
              <Button onClick={() => void saveConfig()} disabled={configSaving}>
                {configSaving ? 'در حال ذخیره...' : 'ذخیره پیکربندی پایه'}
              </Button>
            </FieldGroup>
          ) : null}

          {configMessage ? (
            <InlineMessage text={configMessage} variant={configMessage.includes('موفقیت') ? 'success' : 'error'} />
          ) : null}
        </div>
      ) : configLoading ? (
        <InlineMessage text="در حال بارگذاری تنظیمات..." variant="help" />
      ) : null}

      <div className="system-prompt-box" style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="admin-section-header">
          <div>
            <h4>سیستم پرامپت پایه (System Prompt)</h4>
            <p className="admin-note">دستور پایه مدل با قابلیت نسخه‌بندی خودکار و بازگردانی (Rollback)</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadPromptHistory()} disabled={historyLoading}>
            {historyLoading ? 'در حال بازخوانی تاریخچه...' : 'بروزرسانی تاریخچه'}
          </Button>
        </div>

        {systemPromptLoading ? <InlineMessage text="در حال دریافت متن سیستم پرامپت..." variant="help" /> : null}

        <TextAreaField
          className="system-prompt-textarea"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="متن دستورات سیستم پرامپت را وارد کنید"
          rows={14}
          disabled={!canEdit || systemPromptLoading}
          aria-label="سیستم پرامپت"
        />

        {canEdit ? (
          <div style={{ marginTop: '12px' }}>
            <TextField
              label="توضیح این ویرایش (اختیاری جهت ثبت در تاریخچه)"
              value={promptNote}
              onChange={(e) => setPromptNote(e.target.value)}
              placeholder="مثلاً: بهبود لحن پاسخ‌دهی به کودکان و اصلاح قوانین ایمنی"
            />

            <FieldGroup direction="row" className="config-actions" style={{ marginTop: '12px' }}>
              <Button onClick={() => void saveSystemPrompt()} disabled={systemPromptSaving || systemPromptLoading}>
                {systemPromptSaving ? 'در حال ذخیره و نسخه‌بندی...' : 'ذخیره تغییرات پرامپت'}
              </Button>
            </FieldGroup>
          </div>
        ) : null}

        {systemPromptMessage ? (
          <InlineMessage text={systemPromptMessage} variant={systemPromptMessage.includes('موفقیت') ? 'success' : 'error'} />
        ) : null}

        {history.length > 0 ? (
          <div style={{ marginTop: '24px' }}>
            <h5>تاریخچه نسخه‌های اخیر سیستم پرامپت ({history.length})</h5>
            <div className="admin-table-wrap" style={{ maxHeight: '250px', overflowY: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>نسخه</th>
                    <th>ثبت‌کننده</th>
                    <th>توضیح</th>
                    <th>طول کاراکتر</th>
                    <th>تاریخ ثبت</th>
                    {canEdit ? <th>عملیات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td><strong>نسخه {item.version}</strong></td>
                      <td>{item.author}</td>
                      <td>{item.note || '-'}</td>
                      <td>{item.length} کاراکتر</td>
                      <td>{new Date(item.createdAt).toLocaleString('fa-IR')}</td>
                      {canEdit ? (
                        <td>
                          <FieldGroup direction="row">
                            <Button variant="secondary" size="sm" onClick={() => setDiffVersion(item)}>
                              مشاهده تفاوت (Diff)
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void rollbackPrompt(item)} disabled={systemPromptSaving}>
                              بازگردانی
                            </Button>
                          </FieldGroup>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {diffVersion ? (
        <PromptDiffViewer
          version={diffVersion}
          currentPrompt={systemPrompt}
          onClose={() => setDiffVersion(null)}
          onRollback={(ver) => void rollbackPrompt(ver)}
          canRollback={canEdit}
        />
      ) : null}
    </div>
  );
}
