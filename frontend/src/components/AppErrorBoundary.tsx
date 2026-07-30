import { Component, type ErrorInfo, type ReactNode } from 'react';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app:error-boundary]', error, info.componentStack);
  }

  private retry = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.assign('/home');
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-shell-state app-shell-state--error" role="alert">
        <section className="app-shell-state__card">
          <div className="app-shell-state__visual" aria-hidden="true">
            <span className="app-shell-state__orbit app-shell-state__orbit--one" />
            <span className="app-shell-state__orbit app-shell-state__orbit--two" />
            <img src="/brand/danoa-logo-v2-transparent.png" alt="" />
          </div>
          <p className="app-shell-state__eyebrow">دانوآ کنارته</p>
          <h1>این بخش کامل بارگذاری نشد</h1>
          <p>
            اتصال یا فایل‌های صفحه موقتاً ناهماهنگ شده‌اند. دوباره تلاش کن؛ اطلاعاتت
            محفوظ می‌ماند.
          </p>
          <div className="app-shell-state__actions">
            <button type="button" className="app-shell-state__primary" onClick={this.retry}>
              تلاش دوباره
            </button>
            <button type="button" className="app-shell-state__secondary" onClick={this.goHome}>
              بازگشت به خانه
            </button>
          </div>
        </section>
      </main>
    );
  }
}

