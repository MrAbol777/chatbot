import { useEffect, useState } from 'react';
import { Button, InlineMessage, TextField } from '../../design-system/components';
import { handleAdminResponse } from '../admin.types';

export default function ErrorsTab() {
  const [errors, setErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const loadErrors = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await fetch('/api/admin/errors', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری خطاها ناموفق بود.');
      if (result.ok) {
        setErrors(result.data.items || []);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'خطا در بارگذاری لیست خطاهای سیستم.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadErrors();
  }, []);

  const filteredErrors = errors.filter((item) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      String(item.error_type || '').toLowerCase().includes(q) ||
      String(item.endpoint || '').toLowerCase().includes(q) ||
      String(item.details || '').toLowerCase().includes(q) ||
      String(item.status_code || '').includes(q)
    );
  });

  return (
    <div className="admin-section">
      <div className="admin-section-header" style={{ marginBottom: '16px' }}>
        <div>
          <h3>گزارش خطاهای سامانه (System Error Logs)</h3>
          <p className="admin-note">پیگیری خطاهای کلاینت، سرور و ارائه‌دهندگان سرویس در ۲۴ ساعت اخیر</p>
        </div>
        <Button variant="secondary" onClick={() => void loadErrors()} disabled={loading}>
          {loading ? 'در حال بازخوانی...' : 'بازخوانی خطاها'}
        </Button>
      </div>

      {errorMessage ? <InlineMessage text={errorMessage} variant="error" /> : null}

      <div className="admin-controls">
        <TextField
          className="admin-control-field"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="فیلتر بر اساس نوع خطا، آدرس یا کد وضعیت"
          aria-label="فیلتر خطاها"
          fullWidth={false}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>نوع خطا</th>
              <th>Endpoint</th>
              <th>کد وضعیت</th>
              <th>جزئیات / پیام</th>
              <th>زمان وقوع</th>
            </tr>
          </thead>
          <tbody>
            {filteredErrors.map((item, index) => (
              <tr key={index}>
                <td>
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>{item.error_type}</span>
                </td>
                <td><code>{item.endpoint || '-'}</code></td>
                <td>
                  <span style={{ padding: '2px 6px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: '4px', color: '#f87171' }}>
                    {item.status_code || '-'}
                  </span>
                </td>
                <td>
                  <span style={{ maxWidth: '400px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.details || '-'}
                  </span>
                </td>
                <td>{item.created_at || '-'}</td>
              </tr>
            ))}
            {filteredErrors.length === 0 ? (
              <tr>
                <td colSpan={5}>هیچ خطایی با این فیلتر ثبت نشده است.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
