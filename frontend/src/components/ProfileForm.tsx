import { Button, TextField } from '../design-system/components';
import type { UserProfile } from '../types';

type ProfileFormProps = {
  profile: UserProfile & { id?: number | string; phone?: string };
  profileFormName: string;
  profileFormAge: string;
  profileFormErrors: { name?: string; age?: string };
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAgeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onDeleteAll: () => void;
  onLogout: () => void;
};

function ProfileForm({
  profile,
  profileFormName,
  profileFormAge,
  profileFormErrors,
  onNameChange,
  onAgeChange,
  onSave,
  onDeleteAll,
  onLogout
}: ProfileFormProps) {
  const initials = String(profileFormName || profile.name || 'ک').trim().charAt(0) || 'ک';

  return (
    <div className="profile-form">
      <div className="profile-form-avatar" aria-hidden="true">
        <span className="profile-form-avatar-ring" />
        {initials}
      </div>

      <div className="profile-form-fields">
        <TextField label="نام" type="text" value={profileFormName} onChange={onNameChange} errorText={profileFormErrors.name} />
        <TextField
          label="سن"
          type="text"
          inputMode="numeric"
          pattern="[0-9۰-۹٠-٩]*"
          value={profileFormAge}
          onChange={(event) => onAgeChange(event)}
          errorText={profileFormErrors.age}
        />
        <TextField label="شماره والد" type="text" value={profile.phone || '-'} readOnly helperText="شماره والد هنگام ثبت نام تعیین می‌شود." />
      </div>

      <div className="profile-form-id">
        <span>شناسه یکتا</span>
        <code>{String(profile.id ?? '')}</code>
      </div>

      <div className="profile-form-divider" />

      <div className="profile-form-danger">
        <Button type="button" variant="danger" size="sm" onClick={onDeleteAll}>
          حذف همه گفتگوها
        </Button>
        <Button type="button" variant="danger" size="sm" onClick={onLogout}>
          خروج از حساب
        </Button>
      </div>

      <Button type="button" className="profile-form-save" onClick={onSave}>
        ذخیره تغییرات
      </Button>
    </div>
  );
}

export default ProfileForm;
