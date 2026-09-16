import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileForm from './ProfileForm';

describe('ProfileForm', () => {
  const defaultProps = {
    profile: { id: 123, name: 'علی', age: 12, phone: '09123456789' },
    profileFormName: 'علی',
    profileFormAge: '۱۲',
    profileFormErrors: {},
    onNameChange: vi.fn(),
    onAgeChange: vi.fn(),
    onSave: vi.fn(),
    onDeleteAll: vi.fn(),
    onLogout: vi.fn(),
    showAccountActions: true
  };

  it('does not expose a theme switch while the product is light-mode only', () => {
    render(<ProfileForm {...defaultProps} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText('تم سایت')).not.toBeInTheDocument();
  });

  it('keeps form fields and handlers working', () => {
    const onNameChange = vi.fn();
    const onAgeChange = vi.fn();
    const onSave = vi.fn();
    render(<ProfileForm {...defaultProps} profileFormName="سارا" profileFormAge="۲۵" onNameChange={onNameChange} onAgeChange={onAgeChange} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue('سارا'), { target: { value: 'مریم' } });
    fireEvent.change(screen.getByDisplayValue('۲۵'), { target: { value: '۲۶' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    expect(onNameChange).toHaveBeenCalledTimes(1);
    expect(onAgeChange).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
