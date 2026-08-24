import React from 'react';
import { Button, TextField, InlineMessage } from '../../design-system/components';
import { filterLocalizedDigits } from '../../utils/chatMessages';
import { LandingStep } from '../../types/chat.types';
import { PUBLIC_ASSETS } from '../../config/publicAssets';
import Icon from '../Icon';

interface AuthFormProps {
  includeLanding?: boolean;
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
  name: string;
  age: string;
  errors: Record<string, string | undefined>;
  onPhoneChange: (phone: string) => void;
  onVerificationCodeChange: (code: string) => void;
  onNameChange: (name: string) => void;
  onAgeChange: (age: string) => void;
  onRegisterStepOne: (event: React.FormEvent) => void;
  onVerifyCode: (event: React.FormEvent) => void;
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

export const AuthForm: React.FC<AuthFormProps> = ({
  includeLanding = true,
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
  name,
  age,
  errors,
  onPhoneChange,
  onVerificationCodeChange,
  onNameChange,
  onAgeChange,
  onRegisterStepOne,
  onVerifyCode,
  onCompleteProfile,
  onBackToLanding,
  onBackToStep1,
  onBackToStep2,
  onStartViana
}) => {
  const authCardClass = `register-card auth-card ${authTransition === 'back' ? 'slide-back' : 'slide-forward'}`;
  const authActionText = isCheckingPhone
    ? 'در حال بررسی شماره...'
    : isSendingVerification
      ? 'در حال ارسال کد...'
      : verificationRetrySeconds > 0
        ? `تلاش دوباره تا ${verificationRetrySeconds} ثانیه`
        : 'ادامه با کد تایید';
  const notice = authNoticeMessage(vianaNotice);

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
            ورود با Viana
          </Button>
        </>
      ) : null}
      {notice ? <InlineMessage text={notice.text} variant={notice.variant} className="viana-auth-notice" /> : null}
    </div>
  );

  return (
    <>
      {includeLanding && landingStep === 'landing' ? (
        <form className={`${authCardClass} auth-card--entry`} onSubmit={onRegisterStepOne} data-clarity-mask="true">
          <div className="auth-brand">
            <span className="auth-logo-mark" aria-hidden="true"><img src={PUBLIC_ASSETS.brandMark} alt="" /></span>
            <div>
              <p className="auth-eyebrow">ورود به دانوآ</p>
              <h1>حساب کاربری</h1>
            </div>
          </div>
          <p className="subtitle">
            شماره موبایل را وارد کن؛ اگر قبلاً حساب داشته باشی وارد همان گفتگوها می‌شوی، و اگر تازه باشی بعد از تایید کد فقط اسم و سن را می‌پرسیم.
          </p>

          <TextField
            label="شماره موبایل"
            value={phone}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPhoneChange(filterLocalizedDigits(event.target.value))}
            placeholder="09123456789"
            type="tel"
            inputMode="numeric"
            pattern="[0-9۰-۹٠-٩]*"
            maxLength={11}
            autoComplete="tel"
            helperText="کد تایید برای همین شماره پیامک می‌شود."
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

          <p className="helper onboarding-help">
            {hasSavedAccount
              ? 'روی این مرورگر قبلاً حساب ذخیره شده؛ با همان شماره وارد شو.'
              : 'برای استفاده از چت، تصویر و ویدئو باید وارد حساب کاربری شوی.'}
          </p>
        </form>
      ) : registrationStep === 1 ? (
        <form className={authCardClass} onSubmit={onRegisterStepOne} data-clarity-mask="true">
          {includeLanding ? (
            <button
              type="button"
              className="auth-back-btn"
              onClick={onBackToLanding}
            >
              <Icon name="chevron-left" size={18} aria-hidden="true" />
              <span>بازگشت</span>
            </button>
          ) : null}
          <div className="auth-step-row">
            <span>1</span>
            <p>شماره موبایل</p>
          </div>
          <h1>ورود یا ساخت حساب</h1>
          <p className="subtitle">شماره را وارد کن تا کد تایید بفرستیم. دانوآ خودش تشخیص می‌دهد حساب قبلی داری یا نه.</p>

          <TextField
            label="شماره موبایل"
            value={phone}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPhoneChange(filterLocalizedDigits(event.target.value))}
            placeholder="09123456789"
            type="tel"
            inputMode="numeric"
            pattern="[0-9۰-۹٠-٩]*"
            maxLength={11}
            autoComplete="tel"
            helperText="فرمت معتبر: 09XXXXXXXXX"
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
        <form className={authCardClass} onSubmit={onVerifyCode} data-clarity-mask="true">
          <button
            type="button"
            className="auth-back-btn"
            onClick={onBackToStep1}
          >
            <Icon name="chevron-left" size={18} aria-hidden="true" />
            <span>بازگشت</span>
          </button>
          <div className="auth-step-row">
            <span>2</span>
            <p>تایید شماره</p>
          </div>
          <h1>کد تایید</h1>
          <p className="subtitle">کدی که برای شماره زیر پیامک شده را وارد کن.</p>
          {verificationNotice ? <InlineMessage text={verificationNotice} variant="warning" /> : null}
          <p className="auth-phone-badge" dir="ltr">{phone || '09XXXXXXXXX'}</p>

          <TextField
            label="کد تایید"
            value={verificationCode}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onVerificationCodeChange(filterLocalizedDigits(event.target.value))}
            placeholder="12345"
            type="tel"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            errorText={errors.code}
          />

          <div className="ds-auth-actions">
            <Button
              type="button"
              variant="danger"
              onClick={onBackToStep1}
            >
              تغییر شماره
            </Button>
            <Button type="submit" className="start-btn" disabled={isVerifyingCode}>
              {isVerifyingCode ? 'در حال بررسی...' : 'تأیید'}
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
            <Icon name="chevron-left" size={18} aria-hidden="true" />
            <span>بازگشت</span>
          </button>
          <div className="auth-step-row">
            <span>3</span>
            <p>تکمیل حساب</p>
          </div>
          <h1>اطلاعات کودک</h1>
          <p className="subtitle">این شماره قبلاً در دانوآ ثبت نشده بود. برای ساخت حساب، اسم و سن کودک را وارد کن.</p>
          <p className="auth-phone-badge" dir="ltr">{phone}</p>

          <TextField
            label="اسم کودک"
            value={name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onNameChange(event.target.value)}
            placeholder="مثلا: علی"
            type="text"
            autoComplete="name"
            errorText={errors.name}
          />

          <TextField
            label="سن کودک"
            value={age}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onAgeChange(filterLocalizedDigits(event.target.value))}
            placeholder="فقط عدد"
            type="text"
            inputMode="numeric"
            pattern="[0-9۰-۹٠-٩]*"
            maxLength={2}
            errorText={errors.age}
          />

          <Button type="submit" className="start-btn" disabled={isCompletingProfile}>
            {isCompletingProfile ? 'در حال ذخیره...' : 'ورود به دانوآ'}
          </Button>
        </form>
      )}
    </>
  );
};
