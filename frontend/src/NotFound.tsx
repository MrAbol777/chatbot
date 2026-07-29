import { Button } from './design-system/components';

function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        padding: '32px 16px',
        textAlign: 'center',
        fontFamily: 'var(--font-family-base)',
        color: '#191c1e',
        direction: 'rtl'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: '4rem',
          lineHeight: 1,
          fontWeight: 900,
          color: '#630ed4',
          opacity: 0.24
        }}
      >
        ۴۰۴
      </span>
      <h1 style={{ margin: 0, fontSize: 'clamp(1.4rem, 4vw, 2rem)', fontWeight: 900 }}>
        صفحه پیدا نشد
      </h1>
      <p style={{ margin: 0, color: '#4a4455', maxWidth: '380px', lineHeight: 1.8 }}>
        صفحه‌ای که دنبالش هستی وجود نداره یا حذف شده.
      </p>
      <Button
        type="button"
        onClick={() => {
          window.location.assign('/home');
        }}
      >
        بازگشت به خانه
      </Button>
    </main>
  );
}

export default NotFound;
