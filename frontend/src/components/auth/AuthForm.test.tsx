import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

const defaultProps = {
  includeLanding: false,
  authMode: 'signup' as const,
  landingStep: 'signup' as const,
  registrationStep: 1,
  authTransition: 'forward' as const,
  isCheckingPhone: false,
  isSendingVerification: false,
  isVerifyingCode: false,
  isCompletingProfile: false,
  verificationRetrySeconds: 0,
  vianaEnabled: false,
  vianaRedirecting: false,
  hasSavedAccount: false,
  phone: '09123456789',
  verificationCode: '',
  name: '',
  age: '',
  errors: {},
  onPhoneChange: vi.fn(),
  onVerificationCodeChange: vi.fn(),
  onNameChange: vi.fn(),
  onAgeChange: vi.fn(),
  onRegisterStepOne: vi.fn(),
  onVerifyCode: vi.fn(),
  onResendVerification: vi.fn(),
  onCompleteProfile: vi.fn(),
  onBackToLanding: vi.fn(),
  onBackToStep1: vi.fn(),
  onBackToStep2: vi.fn(),
  onStartViana: vi.fn()
};

describe('AuthForm mode-specific flow', () => {
  it('shows signup copy and truthful progress across all three steps', () => {
    const { rerender } = render(<AuthForm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'ساخت حساب' })).toBeInTheDocument();
    expect(screen.getByLabelText('مرحله ۱ از ۳')).toBeInTheDocument();

    rerender(<AuthForm {...defaultProps} registrationStep={2} />);
    expect(screen.getByRole('heading', { name: 'تأیید شماره موبایل' })).toBeInTheDocument();
    expect(screen.getByLabelText('مرحله ۲ از ۳')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تأیید و ادامه' })).toBeInTheDocument();

    rerender(<AuthForm {...defaultProps} registrationStep={3} />);
    expect(screen.getByRole('heading', { name: 'ساخت حساب' })).toBeInTheDocument();
    expect(screen.getByLabelText('مرحله ۳ از ۳')).toBeInTheDocument();
  });

  it('shows login copy and truthful progress across both login steps', () => {
    const loginProps = { ...defaultProps, authMode: 'login' as const, landingStep: 'login' as const };
    const { rerender } = render(<AuthForm {...loginProps} />);

    expect(screen.getByRole('heading', { name: 'ورود به حساب' })).toBeInTheDocument();
    expect(screen.getByLabelText('مرحله ۱ از ۲')).toBeInTheDocument();

    rerender(<AuthForm {...loginProps} registrationStep={2} />);
    expect(screen.getByRole('heading', { name: 'کد ورود' })).toBeInTheDocument();
    expect(screen.getByLabelText('مرحله ۲ از ۲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تأیید و ورود' })).toBeInTheDocument();
  });

  it('updates visible copy and progress when the resolved auth mode changes', () => {
    const { rerender } = render(<AuthForm {...defaultProps} registrationStep={2} />);
    expect(screen.getByLabelText('مرحله ۲ از ۳')).toBeInTheDocument();

    rerender(<AuthForm {...defaultProps} authMode="login" landingStep="login" registrationStep={2} />);
    expect(screen.getByRole('heading', { name: 'کد ورود' })).toBeInTheDocument();
    expect(screen.getByLabelText('مرحله ۲ از ۲')).toBeInTheDocument();
  });

  it('keeps the neutral entry copy before a mode-specific flow begins', () => {
    render(<AuthForm {...defaultProps} includeLanding landingStep="landing" />);

    expect(screen.getByRole('heading', { name: 'ورود یا ساخت حساب' })).toBeInTheDocument();
    expect(screen.queryByText(/مرحله/)).not.toBeInTheDocument();
  });
});
