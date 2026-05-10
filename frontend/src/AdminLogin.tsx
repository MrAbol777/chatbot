import { FormEvent, useState } from 'react';

type Props = {
  onLoginSuccess: () => void;
};

function AdminLogin({ onLoginSuccess }: Props) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error || 'ورود ناموفق بود.');
        return;
      }

      onLoginSuccess();
    } catch (_error) {
      setError('خطا در ارتباط با سرور.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: 24, border: '1px solid #ddd', borderRadius: 12 }}>
      <h2>ورود ادمین</h2>
      <form onSubmit={handleSubmit}>
        <label>
          نام کاربری
          <input value={username} onChange={(event) => setUsername(event.target.value)} style={{ width: '100%', marginTop: 6 }} />
        </label>
        <label style={{ display: 'block', marginTop: 12 }}>
          رمز عبور
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%', marginTop: 6 }}
          />
        </label>
        {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
        <button type="submit" disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'در حال ورود...' : 'ورود'}
        </button>
      </form>
    </div>
  );
}

export default AdminLogin;
