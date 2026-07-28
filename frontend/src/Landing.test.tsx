import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './Landing';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      tomanPerNoa: '10000.000000',
      pricingConfigs: [
        { actionKey: 'text_chat', unit: 'message', unitPriceNoa: '0.120000', isActive: true },
        { actionKey: 'image_generation', unit: 'image', unitPriceNoa: '1.700000', isActive: true },
        { actionKey: 'video_generation', unit: 'second', unitPriceNoa: '0.800000', isActive: true },
      ],
    }),
  }));
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

  it('renders Noa section header', () => {
    render(<LandingPage />);
    expect(screen.getAllByText('کیف پول نوآ').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('کیف پول نوآ').length).toBeGreaterThan(0);
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

describe('LandingPage — live Noa pricing', () => {
  it('renders only the live database pricing payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tomanPerNoa: '12500.000000',
        pricingConfigs: [
          { actionKey: 'text_chat', unit: 'message', unitPriceNoa: '0.230000', isActive: true },
          { actionKey: 'image_generation', unit: 'image', unitPriceNoa: '2.100000', isActive: false },
        ],
      }),
    }));
    render(<LandingPage />);
    await waitFor(() => {
      expect(screen.getByText('۰٫۲۳ نوآ')).toBeInTheDocument();
      expect(screen.getByText(/۱۲٬۵۰۰ تومان/)).toBeInTheDocument();
    });
    expect(screen.queryByText('۲٫۱ نوآ')).toBeNull();
  });

  it('does not invent fallback prices when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(<LandingPage />);
    await waitFor(() => {
      expect(screen.getByText(/قیمت‌های لحظه‌ای نوآ اکنون در دسترس نیست/)).toBeInTheDocument();
    });
    expect(screen.queryByText('۰٫۱۲ نوآ')).toBeNull();
  });
});

describe('LandingPage — CTA navigation', () => {
  it('has an account creation button in header that navigates', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    render(<LandingPage />);
    const cta = screen.getAllByText('ساخت حساب')[0];
    await userEvent.click(cta);
    expect(assign).toHaveBeenCalledWith('/chat?auth=signup');
  });
});
