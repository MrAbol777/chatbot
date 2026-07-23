import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './Landing';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LandingPage — all sections render', () => {
  it('renders Hero section with heading', () => {
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('دانوآ،')).toBeInTheDocument();
  });

  it('renders Features section header and cards', () => {
    render(<LandingPage />);
    expect(screen.getAllByText('قابلیت‌ها').length).toBeGreaterThan(0);
    expect(screen.getByText('چت هوشمند فارسی')).toBeInTheDocument();
    expect(screen.getByText('استودیوی تصویر')).toBeInTheDocument();
    expect(screen.getByText('ساخت ویدیو با AI')).toBeInTheDocument();
    expect(screen.getByText('داستان‌سازی خلاقانه')).toBeInTheDocument();
  });

  it('renders Trust/Safety section', () => {
    render(<LandingPage />);
    expect(screen.getByText('برای آرامش والدین')).toBeInTheDocument();
    expect(screen.getByText('فضایی امن برای یادگیری و خیال‌پردازی')).toBeInTheDocument();
  });

  it('renders Pricing section header', () => {
    render(<LandingPage />);
    expect(screen.getAllByText('پلن‌ها').length).toBeGreaterThan(0);
  });

  it('renders Testimonials section', () => {
    render(<LandingPage />);
    expect(screen.getByText('نظر خانواده‌ها')).toBeInTheDocument();
    expect(screen.getByText(/تمرین‌های ریاضی را/)).toBeInTheDocument();
  });

  it('renders FAQ section with questions', () => {
    render(<LandingPage />);
    expect(screen.getByText('پرسش‌های متداول')).toBeInTheDocument();
    expect(screen.getByText('دانوآ مناسب چه گروه سنی‌ست؟')).toBeInTheDocument();
  });

  it('renders Final CTA section', () => {
    render(<LandingPage />);
    expect(screen.getByText('شروع یک گفت‌وگوی امن')).toBeInTheDocument();
    expect(screen.getByText('بگذار دانوآ همراه یادگیری و خلاقیت کودکان باشد')).toBeInTheDocument();
  });

  it('renders Footer', () => {
    render(<LandingPage />);
    expect(screen.getByText(/۱۴۰۴ دانوآ/)).toBeInTheDocument();
  });

  it('has only one h1', () => {
    render(<LandingPage />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
  });
});

describe('LandingPage — IntersectionObserver fallback', () => {
  it('shows all content when IntersectionObserver is not available', () => {
    const origObserver = window.IntersectionObserver;
    delete (window as any).IntersectionObserver;
    render(<LandingPage />);
    expect(screen.getByText('دانوآ،')).toBeVisible();
    expect(screen.getAllByText('قابلیت‌ها').length).toBeGreaterThan(0);
    expect(screen.getByText('برای آرامش والدین')).toBeVisible();
    expect(screen.getAllByText('پلن‌ها').length).toBeGreaterThan(0);
    (window as any).IntersectionObserver = origObserver;
  });
});

describe('LandingPage — reduced-motion', () => {
  it('shows content when prefers-reduced-motion is active', () => {
    window.matchMedia = vi.fn().mockImplementation((media: string) => ({
      matches: media === '(prefers-reduced-motion: reduce)',
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<LandingPage />);
    expect(screen.getByText('دانوآ،')).toBeInTheDocument();
    expect(screen.getAllByText('قابلیت‌ها').length).toBeGreaterThan(0);
  });
});

describe('LandingPage — reveal after Intersection', () => {
  it('marks elements as revealed when IntersectionObserver fires', async () => {
    let observeCallback: (entries: IntersectionObserverEntry[]) => void = () => {};
    const origObserver = window.IntersectionObserver;
    (window as any).IntersectionObserver = class Mock {
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) { observeCallback = cb; }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    render(<LandingPage />);
    const revealDivs = document.querySelectorAll('.landing-reveal');
    expect(revealDivs.length).toBeGreaterThan(0);
    observeCallback(
      Array.from(revealDivs).map((el) => ({ isIntersecting: true, target: el, boundingClientRect: { top: 0 } as DOMRectReadOnly }) as unknown as IntersectionObserverEntry)
    );
    await waitFor(() => {
      expect((revealDivs[0] as HTMLElement).dataset.revealed).toBe('true');
    });
    (window as any).IntersectionObserver = origObserver;
  });
});

describe('LandingPage — FAQ keyboard', () => {
  it('toggles FAQ answer on click', async () => {
    render(<LandingPage />);
    const firstBtn = screen.getByText('دانوآ مناسب چه گروه سنی‌ست؟').closest('button')!;
    expect(firstBtn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(firstBtn);
    expect(firstBtn).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(firstBtn);
    expect(firstBtn).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('LandingPage — Pricing filters test plans', () => {
  it('does not render a plan named Metis Video Live Test', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plans: [
          { id: 'free', name: 'رایگان', price: 0, features: ['20 پیام'], description: 'Plan free' },
          { id: 'gold', name: 'طلایی', price: 99000, features: ['300 پیام'], description: 'Plan gold' },
          { id: 'diamond', name: 'الماسی', price: 199000, features: ['پیام نامحدود'], description: 'Plan diamond' },
          { id: 'metis-video-live-test', name: 'Metis Video Live Test', price: 0, features: ['test'], description: 'test-only' },
        ],
      }),
    }));
    render(<LandingPage />);
    await waitFor(() => {
      expect(screen.getByText('رایگان')).toBeInTheDocument();
      expect(screen.getByText('طلایی')).toBeInTheDocument();
      expect(screen.getByText('الماسی')).toBeInTheDocument();
    });
    expect(screen.queryByText('Metis Video Live Test')).toBeNull();
  });

  it('uses fallback plans when API fails and they contain no test plans', async () => {
    render(<LandingPage />);
    await waitFor(() => {
      expect(screen.getByText('رایگان')).toBeInTheDocument();
    });
    expect(screen.queryByText(/test/i)).toBeNull();
  });
});

describe('LandingPage — CTA navigation', () => {
  it('has a start free button in header that navigates', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    render(<LandingPage />);
    const cta = screen.getAllByText('شروع رایگان')[0];
    await userEvent.click(cta);
    expect(assign).toHaveBeenCalledWith('/chat?auth=signup');
  });
});
