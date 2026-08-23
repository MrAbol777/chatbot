import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileForm from './ProfileForm';

describe('ProfileForm theme switch', () => {
  const defaultProps = {
    profile: { id: 123, name: 'علی', age: 12, phone: '09123456789' },
    profileFormName: 'علی',
    profileFormAge: '۱۲',
    profileFormErrors: {},
    colorMode: 'light' as const,
    onColorModeChange: vi.fn(),
    onNameChange: vi.fn(),
    onAgeChange: vi.fn(),
    onSave: vi.fn(),
    onDeleteAll: vi.fn(),
    onLogout: vi.fn(),
    showAccountActions: true
  };

  it('renders theme switch with light mode status and correct accessibility attributes', () => {
    render(<ProfileForm {...defaultProps} colorMode="light" />);

    const switchBtn = screen.getByRole('switch');
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('تم سایت')).toBeInTheDocument();
    expect(screen.getByText('لایت مود')).toBeInTheDocument();
  });

  it('renders theme switch with dark mode status and checked attribute', () => {
    render(<ProfileForm {...defaultProps} colorMode="dark" />);

    const switchBtn = screen.getByRole('switch');
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('دارک مود')).toBeInTheDocument();
  });

  it('triggers onColorModeChange when switch is clicked', () => {
    const handleColorModeChange = vi.fn();
    render(<ProfileForm {...defaultProps} colorMode="light" onColorModeChange={handleColorModeChange} />);

    const switchBtn = screen.getByRole('switch');
    fireEvent.click(switchBtn);

    expect(handleColorModeChange).toHaveBeenCalledTimes(1);
    expect(handleColorModeChange).toHaveBeenCalledWith('dark');
  });

  it('triggers onColorModeChange with Enter and Space keys', () => {
    const handleColorModeChange = vi.fn();
    render(<ProfileForm {...defaultProps} colorMode="dark" onColorModeChange={handleColorModeChange} />);

    const switchBtn = screen.getByRole('switch');

    fireEvent.keyDown(switchBtn, { key: 'Enter' });
    expect(handleColorModeChange).toHaveBeenCalledWith('light');

    fireEvent.keyDown(switchBtn, { key: ' ' });
    expect(handleColorModeChange).toHaveBeenCalledWith('light');
  });

  it('preserves form field values and handlers independently of colorMode prop', () => {
    const handleNameChange = vi.fn();
    const handleAgeChange = vi.fn();
    const handleSave = vi.fn();

    const { rerender } = render(
      <ProfileForm
        {...defaultProps}
        colorMode="light"
        profileFormName="سارا"
        profileFormAge="۲۵"
        onNameChange={handleNameChange}
        onAgeChange={handleAgeChange}
        onSave={handleSave}
      />
    );

    expect(screen.getByDisplayValue('سارا')).toBeInTheDocument();
    expect(screen.getByDisplayValue('۲۵')).toBeInTheDocument();

    // Rerender with colorMode dark
    rerender(
      <ProfileForm
        {...defaultProps}
        colorMode="dark"
        profileFormName="سارا"
        profileFormAge="۲۵"
        onNameChange={handleNameChange}
        onAgeChange={handleAgeChange}
        onSave={handleSave}
      />
    );

    expect(screen.getByDisplayValue('سارا')).toBeInTheDocument();
    expect(screen.getByDisplayValue('۲۵')).toBeInTheDocument();
  });
});
