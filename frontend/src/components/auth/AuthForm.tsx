import React, { useEffect, useRef } from 'react';
import { Button, TextField, InlineMessage } from '../../design-system/components';
import { filterLocalizedDigits, normalizeLocalizedDigits } from '../../utils/chatMessages';
import { AuthMode, LandingStep } from '../../types/chat.types';
import { PUBLIC_ASSETS } from '../../config/publicAssets';
import Icon from '../Icon';
import './AuthForm.css';

type VerificationNoticeVariant = 'error' | 'success' | 'warning' | 'info';

interface AuthFormProps {
  includeLanding?: boolean;
  authMode: AuthMode;
  landingStep: LandingStep;
  registrationStep: number;
  authTransition: 'back' | 'forward';
  isCheckingPhone: boolean;
  isSendingVerification: boolean;
  isVerifyingCode: boolean;
  isCompletingProfile?: boolean;
  verificationRetrySeconds: number;
  vianaEnabled: boolean;
  vianaRedirecting: boolean;
  vianaNotice?: string;
  hasSavedAccount: boolean;
  phone: string;
  verificationCode: string;
  verificationNotice?: string;
  verificationNoticeVariant?: VerificationNoticeVariant;
  name: string;
  age: string;
  errors: Record<string, string | undefined>;
  onPhoneChange: (phone: string) => void;
  onVerificationCodeChange: (code: string) => void;
  onNameChange: (name: string) => void;
  onAgeChange: (age: string) => void;
  onRegisterStepOne: (event: React.FormEvent) => void;
  onVerifyCode: (event: React.FormEvent) => void;
  onResendVerification: () => void;
  onCompleteProfile: (event: React.FormEvent) => void;
  onBackToLanding: () => void;
  onBackToStep1: () => void;
  onBackToStep2: () => void;
  onStartViana: () => void;
}

const authNoticeMessage = (notice?: string): { text: string; variant: 'info' | 'warning' | 'error' } | null => {
  if (!notice) return null;
  if (notice === 'viana_success') {
    return { text: 'ورود با Viana با موفقیت انجام شد.', variant: 'info' };
  }
  if (notice === 'viana_cancelled') {
    return { text: 'ورود با Viana توسط کاربر لغو شد.', variant: 'warning' };
  }
  if (notice === 'viana_error' || notice === 'viana_failed') {
    return { text: 'ورود با Viana انجام نشد. لطفاً با شماره موبایل وارد شو.', variant: 'error' };
  }
  return { text: notice, variant: 'warning' };
};

const toPersianDigits = (value: number | string) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export const AuthForm: React.FC<AuthFormProps> = ({
  includeLanding = true,
  authMode,
  landingStep,
  registrationStep,
  authTransition,
  isCheckingPhone,
  isSendingVerification,
  isVerifyingCode,
  isCompletingProfile = false,
  verificationRetrySeconds,
  vianaEnabled,
  vianaRedirecting,
  vianaNotice,
  hasSavedAccount,
  phone,
  verificationCode,
  verificationNotice,
  verificationNoticeVariant = 'info',
  name,
  age,
  errors,
  onPhoneChange,
  onVerificationCodeChange,
  onNameChange,
  onAgeChange,
  onRegisterStepOne,
  onVerifyCode,
  onResendVerification,
  onCompleteProfile,
  onBackToLanding,
  onBackToStep1,
  onBackToStep2,
  onStartViana
}) => {
  const verificationCodeInputRef = useRef<HTMLInputElement>(null);
  const authCardClass = `register-card auth-card ${authTransition === 'back' ? 'slide-back' : 'slide-forward'}`;
  const authActionText = isCheckingPhone
    ? 'در حال بررسی شماره...'
    : isSendingVerification
      ? 'در حال ارسال کد...'
      : verificationRetrySeconds > 0
        ? `تلاش دوباره تا ${toPersianDigits(verificationRetrySeconds)} ثانیه`
        : 'دریافت کد تأیید';
  const notice = authNoticeMessage(vianaNotice);
  const isSignup = authMode === 'signup';
  const totalAuthSteps = isSignup ? 3 : 2;
  const authCopy = isSignup
    ? {
        phoneTitle: 'ساخت حساب',
        phoneSubtitle: 'برای ساخت حساب، شماره موبایلت را وارد کن تا کد تأیید را برایت ارسال کنیم.',
        codeTitle: 'تأیید شماره موبایل',
        codeSubtitle: 'کد ارسال‌شده را وارد کن تا به مرحله ساخت پروفایل بروی.',
        codeAction: 'تأیید و ادامه'
      }
    : {
        phoneTitle: 'ورود به حساب',
        phoneSubtitle: 'شماره موبایلی را که با آن حساب ساخته‌ای وارد کن تا کد ورود را برایت ارسال کنیم.',
        codeTitle: 'کد ورود',
        codeSubtitle: 'کد ارسال‌شده را وارد کن تا وارد حسابت شوی.',
        codeAction: 'تأیید و ورود'
      };

  useEffect(() => {
    if (registrationStep !== 2) return;
    const frame = window.requestAnimationFrame(() => verificationCodeInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [registrationStep]);

  const maskPhone = (value: string) => {
    const normalized = normalizeLocalizedDigits(value).replace(/\D/g, '');
    if (normalized.length < 8) return value || '09XXXXXXXXX';
    return `${normalized.slice(0, 4)} *** ${normalized.slice(-4)}`;
  };

  const progressLabel = (step: number) => `مرحله ${toPersianDigits(step)} از ${toPersianDigits(totalAuthSteps)}`;

  const renderVianaAction = () => (
    <div className="viana-auth-section">
      {vianaEnabled ? (
        <>
          <div className="auth-divider" aria-hidden="true">
            <span />
            <b>یا</b>
            <span />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="viana-signin-button"
            loading={vianaRedirecting}
            disabled={vianaRedirecting || isSendingVerification || isCheckingPhone || isVerifyingCode}
            onClick={onStartViana}
          >
            ورود با حساب Viana
          </Button>
        </>
      ) : null}
      {notice ? <InlineMessage text={notice.text} variant={notice.variant} className="viana-auth-notice" /> : null}
    </div>
  );

  return (
    <>
      {includeLanding && landingStep === 'landing' ? (
        <form
          className={`${authCardClass} auth-card--entry`}
          onSubmit={onRegisterStepOne}
          data-clarity-mask="true"
          aria-busy={isCheckingPhone || isSendingVerification}
        >
          <div className="auth-brand">
            <span className="auth-logo-mark" aria-hidden="true"><img src={PUBLIC_ASSETS.brandMark} alt="" /></span>
            <div>
              <p className="auth-eyebrow">دانوآ</p>
              <h1>ورود یا ساخت حساب</h1>
            </div>
          </div>
          <p className="subtitle">شماره موبایلت را وارد کن. کد تأیید را برایت پیامک می‌کنیم.</p>

          <TextField
            label="شماره موبایل"
            value={phone}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPhoneChange(filterLocalizedDigits(event.target.value))}
            placeholder="مثال: ۰۹۱۲۳۴۵۶۷۸۹"
            type="tel"
            inputMode="numeric"
            enterKeyHint="next"
            dir="ltr"
            pattern="[0-9۰-۹٠-٩]*"
            maxLength={11}
            autoComplete="tel"
            helperText="کد تأیید به همین شماره ارسال می‌شود."
            errorText={errors.phone}
          />

          <Button
            type="submit"
            className="start-btn auth-primary-action"
            disabled={isSendingVerification || isCheckingPhone || verificationRetrySeconds > 0}
          >
            {authActionText}
          </Button>
          {renderVianaAction()}

          <p className="helper onboarding-help" role="note">
            {hasSavedAccount
              ? 'در این مرورگر یک حساب ذخیره شده است؛ برای بازیابی گفتگوها همان شماره را وارد کن.'
              : 'با ورود به حساب، گفتگوها و ابزارهای دانوآ در دسترس قرار می‌گیرند.'}
          </p>
        </form>
      ) : registrationStep === 1 ? (
        <form
          className={authCardClass}
          onSubmit={onRegisterStepOne}
          data-clarity-mask="true"
          aria-busy={isCheckingPhone || isSendingVerification}
        >
          {includeLanding ? (
            <button
              type="button"
              className="auth-back-btn"
              onClick={onBackToLanding}
            >
              <Icon name="chevron-right" size={18} aria-hidden="true" />
              <span>بازگشت</span>
            </button>
          ) : null}
          <div className="auth-step-row" aria-label={progressLabel(1)}>
            <span>۱</span>
            <p>{progressLabel(1)}</p>
          </div>
          <h1>{authCopy.phoneTitle}</h1>
          <p className="subtitle">{authCopy.phoneSubtitle}</p>

          <TextField
            label="شماره موبایل"
            value={phone}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPhoneChange(filterLocalizedDigits(event.target.value))}
            placeholder="مثال: ۰۹۱۲۳۴۵۶۷۸۹"
            type="tel"
            inputMode="numeric"
            enterKeyHint="next"
            dir="ltr"
            pattern="[0-9۰-۹٠-٩]*"
            maxLength={11}
            autoComplete="tel"
            helperText="شماره باید با ۰۹ شروع شود و ۱۱ رقم داشته باشد."
            errorText={errors.phone}
          />

          <Button
            type="submit"
            className="start-btn"
            disabled={isSendingVerification || isCheckingPhone || verificationRetrySeconds > 0}
          >
            {authActionText}
          </Button>
          {renderVianaAction()}
        </form>
      ) : registrationStep === 2 ? (
        <form className={authCardClass} onSubmit={onVerifyCode} data-clarity-mask="true" aria-busy={isVerifyingCode || isSendingVerification}>
          <button
            type="button"
            className="auth-back-btn"
            onClick={onBackToStep1}
          >
            <Icon name="chevron-right" size={18} aria-hidden="true" />
            <span>بازگشت</span>
          </button>
          <div className="auth-step-row" aria-label={progressLabel(2)}>
            <span>۲</span>
            <p>{progressLabel(2)}</p>
          </div>
          <h1>{authCopy.codeTitle}</h1>
          <p className="subtitle">{authCopy.codeSubtitle}</p>
          {verificationNotice ? <InlineMessage text={verificationNotice} variant={verificationNoticeVariant} /> : null}
          <div className="auth-phone-badge">
            <span>ارسال به</span>
            <bdi dir="ltr">{maskPhone(phone)}</bdi>
          </div>

          <TextField
            ref={verificationCodeInputRef}
            label="کد تایید"
            value={verificationCode}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onVerificationCodeChange(filterLocalizedDigits(event.target.value))}
            placeholder="مثال: ۱۲۳۴۵"
            type="tel"
            inputMode="numeric"
            enterKeyHint="done"
            dir="ltr"
            maxLength={6}
            autoComplete="one-time-code"
            helperText="کد ۴ تا ۶ رقمی را بدون فاصله وارد کن."
            errorText={errors.code}
          />

          <div className="auth-resend-row" aria-live="polite">
            <span>کد را دریافت نکردی؟</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="auth-resend-button"
              disabled={isSendingVerification || verificationRetrySeconds > 0}
              onClick={onResendVerification}
            >
              {isSendingVerification
                ? 'در حال ارسال...'
                : verificationRetrySeconds > 0
                  ? `ارسال دوباره تا ${toPersianDigits(verificationRetrySeconds)} ثانیه`
                  : 'ارسال دوباره'}
            </Button>
          </div>

          <div className="ds-auth-actions">
            <Button type="submit" className="start-btn" disabled={isVerifyingCode} loading={isVerifyingCode}>
              {authCopy.codeAction}
            </Button>
            <Button type="button" variant="secondary" className="auth-secondary-action" onClick={onBackToStep1}>
              ویرایش شماره
            </Button>
          </div>
        </form>
      ) : (
        <form className={authCardClass} onSubmit={onCompleteProfile} data-clarity-mask="true">
          <button
            type="button"
            className="auth-back-btn"
            onClick={onBackToStep2}
          >
            <Icon name="chevron-right" size={18} aria-hidden="true" />
            <span>بازگشت</span>
          </button>
          <div className="auth-step-row" aria-label="مرحله ۳ از ۳">
            <span>۳</span>
            <p>مرحله ۳ از ۳</p>
          </div>
          <h1>ساخت حساب</h1>
          <p className="subtitle">این شماره قبلاً در دانوآ ثبت نشده بود. برای ساخت حساب، اسم و سن کودک را وارد کن.</p>
          <div className="auth-phone-badge">
            <span>شماره تأییدشده</span>
            <bdi dir="ltr">{maskPhone(phone)}</bdi>
          </div>

          <TextField
            label="اسم کودک"
            value={name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onNameChange(event.target.value)}
            placeholder="مثلاً: علی"
            type="text"
            autoComplete="name"
            errorText={errors.name}
          />

          <TextField
            label="سن کودک"
            value={age}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onAgeChange(filterLocalizedDigits(event.target.value))}
            placeholder="مثلاً: ۱۲"
            type="text"
            inputMode="numeric"
            pattern="[0-9۰-۹٠-٩]*"
            maxLength={2}
            errorText={errors.age}
          />

          <Button type="submit" className="start-btn" disabled={isCompletingProfile} loading={isCompletingProfile}>
            ساخت حساب و ورود
          </Button>
        </form>
      )}
    </>
  );
};
