import { useEffect, useState } from 'react';
import { Button, FieldGroup, InlineMessage, TextField } from '../../design-system/components';
import type { ReportFormat, ReportRangePreset, ReportSection, ReportUserScope } from '../admin.types';
import { handleAdminResponse } from '../admin.types';

const REPORT_SECTION_OPTIONS: Array<{ key: ReportSection; label: string }> = [
  { key: 'users', label: 'اطلاعات کاربران (Users)' },
  { key: 'errors', label: 'خطاهای سیستم (Errors)' },
  { key: 'conversation_summary', label: 'خلاصه گفتگوها (Conversation summary)' },
  { key: 'messages', label: 'متن پیام‌ها (Messages)' },
  { key: 'ai_performance', label: 'عملکرد هوش مصنوعی (AI performance)' },
  { key: 'supervised_otp_usage', label: 'مصرف رمز نظارتی (Supervised OTP)' }
];

const formatDateInput = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
};

type AuditTabProps = {
  selectedReportUserIds: string[];
  onClearSelectedReportUsers: () => void;
};

export default function AuditTab({
  selectedReportUserIds,
  onClearSelectedReportUsers
}: AuditTabProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  // Report export options
  const [reportFormat, setReportFormat] = useState<ReportFormat>('csv');
  const [reportRangePreset, setReportRangePreset] = useState<ReportRangePreset>('7d');
  const [reportCustomFromDate, setReportCustomFromDate] = useState('');
  const [reportCustomToDate, setReportCustomToDate] = useState('');
  const [reportAmbiguousOnly, setReportAmbiguousOnly] = useState(false);
  const [reportUserScope, setReportUserScope] = useState<ReportUserScope>('all');
  const [reportOptions, setReportOptions] = useState<Record<ReportSection, boolean>>({
    users: true,
    errors: false,
    conversation_summary: false,
    messages: false,
    ai_performance: true,
    supervised_otp_usage: false
  });

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/audit-logs?page=1&pageSize=50', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری لاگ‌ها ناموفق بود.');
      if (result.ok) {
        setLogs(result.data.items || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری گزارش ممیزی.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const toggleReportSection = (section: ReportSection, checked: boolean) => {
    setReportOptions((prev) => ({ ...prev, [section]: checked }));
  };

  const getReportDateRange = () => {
    const now = new Date();
    if (reportRangePreset === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { fromDate: formatDateInput(start), toDate: formatDateInput(now) };
    }
    if (reportRangePreset === '7d') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { fromDate: formatDateInput(start), toDate: formatDateInput(now) };
    }
    if (reportRangePreset === '30d') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { fromDate: formatDateInput(start), toDate: formatDateInput(now) };
    }
    return { fromDate: reportCustomFromDate, toDate: reportCustomToDate };
  };

  const downloadReport = () => {
    const selectedSections = Object.entries(reportOptions)
      .filter(([, checked]) => checked)
      .map(([section]) => section);

    if (selectedSections.length === 0) return;

    const params = new URLSearchParams();
    params.set('format', reportFormat);
    params.set('sections', selectedSections.join(','));
    const dateRange = getReportDateRange();
    if (dateRange.fromDate) params.set('fromDate', dateRange.fromDate);
    if (dateRange.toDate) params.set('toDate', dateRange.toDate);
    if (reportUserScope === 'selected' && selectedReportUserIds.length > 0) {
      params.set('userIds', selectedReportUserIds.join(','));
    }
    if (reportAmbiguousOnly) params.set('ambiguousOnly', '1');
    window.open(`/api/admin/reports/export?${params.toString()}`, '_blank');
  };

  const filteredLogs = logs.filter((item) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      String(item.action || '').toLowerCase().includes(q) ||
      String(item.adminUsername || '').toLowerCase().includes(q) ||
      String(item.target || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="admin-section">
      <div className="admin-section-header" style={{ marginBottom: '16px' }}>
        <div>
          <h3>گزارش و ردپای ممیزی (Audit Trail & Reporting)</h3>
          <p className="admin-note">مشاهده تمام عملیات حساس انجام‌شده توسط ادمین‌ها و استخراج گزارش‌های آماری</p>
        </div>
        <Button variant="secondary" onClick={() => void loadLogs()} disabled={loading}>
          {loading ? 'در حال بازخوانی...' : 'بازخوانی رویدادها'}
        </Button>
      </div>

      {error ? <InlineMessage text={error} variant="error" /> : null}

      <div className="admin-controls">
        <TextField
          className="admin-control-field"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="فیلتر بر اساس اکشن، نام ادمین یا هدف"
          aria-label="فیلتر لاگ‌ها"
          fullWidth={false}
        />
      </div>

      <div className="admin-table-wrap" style={{ marginBottom: '32px' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>زمان</th>
              <th>ادمین</th>
              <th>نوع عملیات</th>
              <th>هدف</th>
              <th>جزئیات</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((item, index) => (
              <tr key={index}>
                <td>{item.timestamp || '-'}</td>
                <td><strong>{item.adminUsername || '-'}</strong></td>
                <td>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', fontWeight: 600 }}>
                    {item.action || '-'}
                  </span>
                </td>
                <td>{item.target || '-'}</td>
                <td>
                  <span style={{ maxWidth: '380px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {JSON.stringify(item.details || {})}
                  </span>
                </td>
              </tr>
            ))}
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5}>رویدادی یافت نشد.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="admin-section admin-report admin-card-box">
        <h4 style={{ margin: '0 0 8px 0' }}>مرکز استخراج گزارش‌های آماری و مکالمات</h4>
        <p className="admin-note" style={{ marginBottom: '16px' }}>
          امکان استخراج داده‌های خام و لاگ مکالمات با فرمت TXT (بهینه‌شده برای تحلیل هوش مصنوعی) یا CSV
        </p>

        <FieldGroup direction="row" className="admin-report-options">
          <label className="admin-select-field">
            <span>فرمت خروجی</span>
            <select value={reportFormat} onChange={(e) => setReportFormat(e.target.value as ReportFormat)}>
              <option value="csv">CSV (جدول اکسل)</option>
              <option value="txt">TXT (ساختاریافته برای AI)</option>
            </select>
          </label>
          <label className="admin-select-field">
            <span>بازه زمانی</span>
            <select value={reportRangePreset} onChange={(e) => setReportRangePreset(e.target.value as ReportRangePreset)}>
              <option value="today">امروز</option>
              <option value="7d">۷ روز اخیر</option>
              <option value="30d">۳۰ روز اخیر</option>
              <option value="custom">بازه دلخواه</option>
            </select>
          </label>
        </FieldGroup>

        {reportRangePreset === 'custom' ? (
          <FieldGroup direction="row" className="admin-report-options" style={{ marginTop: '12px' }}>
            <label className="admin-control-field">
              <span>از تاریخ</span>
              <input type="date" value={reportCustomFromDate} onChange={(e) => setReportCustomFromDate(e.target.value)} />
            </label>
            <label className="admin-control-field">
              <span>تا تاریخ</span>
              <input type="date" value={reportCustomToDate} onChange={(e) => setReportCustomToDate(e.target.value)} />
            </label>
          </FieldGroup>
        ) : null}

        <div style={{ marginTop: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>بخش‌های موجود در گزارش:</span>
          <FieldGroup direction="row" className="admin-report-options">
            {REPORT_SECTION_OPTIONS.map((section) => (
              <label key={section.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={reportOptions[section.key]}
                  onChange={(e) => toggleReportSection(section.key, e.target.checked)}
                />
                {section.label}
              </label>
            ))}
          </FieldGroup>
        </div>

        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reportAmbiguousOnly}
              onChange={(e) => setReportAmbiguousOnly(e.target.checked)}
            />
            <span>فقط پیام‌های کوتاه و مبهم کاربر (جهت عیب‌یابی الگوهای ابهام)</span>
          </label>
        </div>

        <div style={{ marginTop: '16px' }}>
          <FieldGroup direction="row" className="admin-report-options">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="report-user-scope"
                checked={reportUserScope === 'all'}
                onChange={() => setReportUserScope('all')}
              />
              همه کاربران
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="report-user-scope"
                checked={reportUserScope === 'selected'}
                onChange={() => setReportUserScope('selected')}
              />
              فقط کاربران انتخاب‌شده ({selectedReportUserIds.length} کاربر)
            </label>
            {selectedReportUserIds.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={onClearSelectedReportUsers}>
                پاک کردن انتخاب‌ها
              </Button>
            ) : null}
          </FieldGroup>
        </div>

        <FieldGroup direction="row" className="admin-report-actions" style={{ marginTop: '20px' }}>
          <Button variant="secondary" onClick={downloadReport} disabled={reportUserScope === 'selected' && selectedReportUserIds.length === 0}>
            دانلود و استخراج فایل گزارش
          </Button>
        </FieldGroup>
      </div>
    </div>
  );
}
