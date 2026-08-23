import { useState } from 'react';
import { Button, TextField } from '../design-system/components';
import type { UserProfile } from '../types';

type ProfileFormProps = {
  profile: UserProfile & { id?: number | string; phone?: string };
  profileFormName: string;
  profileFormAge: string;
  profileFormErrors: { name?: string; age?: string };
  colorMode: 'light' | 'dark';
  onColorModeChange: (mode: 'light' | 'dark') => void;
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAgeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onDeleteAll: () => void;
  onLogout: () => void;
  showAccountActions?: boolean;
};

function ProfileForm({
  profile,
  profileFormName,
  profileFormAge,
  profileFormErrors,
  colorMode,
  onColorModeChange,
  onNameChange,
  onAgeChange,
  onSave,
  onDeleteAll,
  onLogout,
  showAccountActions = true
}: ProfileFormProps) {
  const [copiedId, setCopiedId] = useState(false);
  const initials = String(profileFormName || profile.name || 'ک').trim().charAt(0) || 'ک';
  const userId = String(profile.id ?? '');

  const handleCopyId = async () => {
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="profile-form">
      <div className="profile-form-heading">
        <div className="profile-form-avatar" aria-hidden="true">
          <span className="profile-form-avatar-ring" />
          {initials}
        </div>
        <div>
          <h2>اطلاعات حساب کاربری</h2>
          <p>مشخصات فردی خود را مدیریت و به‌روزرسانی کنید.</p>
        </div>
      </div>

      <div className="profile-form-fields">
        <TextField
          label="نام و نام خانوادگی"
          type="text"
          autoComplete="name"
          placeholder="نام خود را وارد کنید"
          value={profileFormName}
          onChange={onNameChange}
          errorText={profileFormErrors.name}
        />
        <TextField
          label="سن (سال)"
          type="text"
          inputMode="numeric"
          pattern="[0-9۰-۹٠-٩]*"
          placeholder="مثلاً ۱۲"
          value={profileFormAge}
          onChange={(event) => onAgeChange(event)}
          errorText={profileFormErrors.age}
        />
        <TextField
          label="شماره همراه"
          type="tel"
          autoComplete="tel"
          value={profile.phone || '-'}
          readOnly
          helperText="شماره همراه حساب در زمان ورود ثبت شده است."
        />
      </div>

      <div className="profile-form-theme">
        <div className="profile-form-theme__info">
          <span className="profile-form-theme__label">تم سایت</span>
          <span className="profile-form-theme__status">
            {colorMode === 'dark' ? 'دارک مود' : 'لایت مود'}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={colorMode === 'dark'}
          aria-label={`تغییر تم سایت، حالت فعلی ${colorMode === 'dark' ? 'دارک مود' : 'لایت مود'}`}
          className={`profile-form-theme__toggle ${colorMode === 'dark' ? 'profile-form-theme__toggle--dark' : ''}`}
          onClick={() => onColorModeChange(colorMode === 'dark' ? 'light' : 'dark')}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              onColorModeChange(colorMode === 'dark' ? 'light' : 'dark');
            }
          }}
        >
          <span className="profile-form-theme__track">
            <span className="profile-form-theme__thumb">
              {colorMode === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              )}
            </span>
          </span>
        </button>
      </div>

      {userId ? (
        <div className="profile-form-id">
          <div className="profile-form-id__info">
            <span>شناسه کاربری:</span>
            <code>{userId}</code>
          </div>
          <button
            type="button"
            className="profile-form-id__copy-btn"
            onClick={handleCopyId}
            title="کپی شناسه کاربری"
            aria-label="کپی شناسه کاربری"
          >
            {copiedId ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>کپی شد</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span>کپی</span>
              </>
            )}
          </button>
        </div>
      ) : null}

      <div className="profile-form-actions">
        <Button type="button" className="profile-form-save" onClick={onSave}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span>ذخیره تغییرات</span>
        </Button>
      </div>

      {showAccountActions ? (
        <>
          <div className="profile-form-divider" />
          <div className="profile-form-danger">
            <Button type="button" variant="danger" size="sm" onClick={onDeleteAll}>
              حذف همه گفتگوها
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={onLogout}>
              خروج از حساب
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default ProfileForm;
