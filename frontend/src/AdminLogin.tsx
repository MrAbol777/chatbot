import { FormEvent, useState } from 'react';
import { Button, Card, FieldGroup, TextField } from './design-system/components';

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
      setError('اتصال به سرور برقرار نشد. لطفاً اینترنت خود را بررسی کنید.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ maxWidth: 420, margin: '60px auto' }}>
      <h2 style={{ marginTop: 0 }}>ورود ادمین</h2>
      <form onSubmit={handleSubmit}>
        <FieldGroup direction="column">
          <TextField 
            label="نام کاربری" 
            value={username} 
            onChange={(event) => setUsername(event.target.value)} 
          />
          
          <TextField
            label="رمز عبور"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            errorText={error || undefined}
          />

          <Button type="submit" disabled={loading}>
            {loading ? 'در حال ورود...' : 'ورود'}
          </Button>
        </FieldGroup>
      </form>
    </Card>
  );
}

export default AdminLogin;
