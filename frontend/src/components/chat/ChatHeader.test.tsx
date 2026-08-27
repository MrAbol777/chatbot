import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatHeader } from './ChatHeader';

const renderHeader = (overrides: Partial<React.ComponentProps<typeof ChatHeader>> = {}) => {
  const props: React.ComponentProps<typeof ChatHeader> = {
    sidebarOpen: true,
    isDesktopLayout: true,
    onOpenSidebar: vi.fn(),
    activeConversationTitle: 'برنامه‌ریزی سفر',
    hasUserMessages: false,
    onOpenStarterIdeas: vi.fn(),
    onOpenStudio: vi.fn(),
    onOpenNoaWallet: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  };

  return { ...render(<ChatHeader {...props} />), props };
};

describe('ChatHeader contextual action', () => {
  it('offers starter ideas for an empty desktop conversation with the sidebar open', async () => {
    const user = userEvent.setup();
    const onOpenStarterIdeas = vi.fn();
    renderHeader({ onOpenStarterIdeas });

    expect(screen.queryByText('برنامه‌ریزی سفر')).not.toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'نمایش پیشنهادهای آماده برای شروع گفتگو' });
    expect(action).toHaveAttribute('aria-haspopup', 'dialog');
    expect(action).toHaveAttribute('aria-expanded', 'false');

    await user.click(action);
    expect(onOpenStarterIdeas).toHaveBeenCalledOnce();
  });

  it('exposes the expanded starter-ideas state to assistive technology', () => {
    renderHeader({ starterIdeasOpen: true });

    expect(screen.getByRole('button', { name: 'نمایش پیشنهادهای آماده برای شروع گفتگو' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('offers the studio after the first user message', async () => {
    const user = userEvent.setup();
    const onOpenStudio = vi.fn();
    renderHeader({ hasUserMessages: true, onOpenStudio });

    const action = screen.getByRole('button', { name: 'باز کردن استودیوی دانوآ' });
    expect(action).toHaveTextContent('رفتن به استودیو');

    await user.click(action);
    expect(onOpenStudio).toHaveBeenCalledOnce();
  });

  it('keeps the conversation title when the sidebar is closed or the layout is not desktop', () => {
    const { rerender, props } = renderHeader({ sidebarOpen: false, hasUserMessages: true });

    expect(screen.getByText('برنامه‌ریزی سفر')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'باز کردن استودیوی دانوآ' })).not.toBeInTheDocument();

    rerender(<ChatHeader {...props} sidebarOpen isDesktopLayout={false} />);
    expect(screen.getByText('برنامه‌ریزی سفر')).toBeInTheDocument();
  });

  it('keeps the title while a conversation is loading', () => {
    renderHeader({ conversationLoading: true });

    expect(screen.getByText('برنامه‌ریزی سفر')).toBeInTheDocument();
    expect(screen.queryByText('ایده برای شروع')).not.toBeInTheDocument();
  });
});
