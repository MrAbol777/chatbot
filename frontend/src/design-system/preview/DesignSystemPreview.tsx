import { useState } from 'react';
import { Button, Card, Dialog, FieldGroup, InlineMessage, TextAreaField, TextField, useNotification } from '../components';
import Icon from '../../components/Icon';

function DesignSystemPreview() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'energy' | 'calm'>('energy');
  const { notify, confirm, prompt } = useNotification();

  const switchTheme = (nextTheme: 'energy' | 'calm') => {
    document.documentElement.setAttribute('data-theme', nextTheme);
    setTheme(nextTheme);
  };

  return (
    <div style={{ padding: '24px', direction: 'rtl' }}>
      <Card className="ds-demo-stack">
        <h1>پیش نمایش دیزاین سیستم</h1>
        
        <FormValidationExample />
        
        <div className="ds-demo-stack">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant={theme === 'energy' ? 'primary' : 'secondary'} onClick={() => switchTheme('energy')}>تم انرژی</Button>
            <Button variant={theme === 'calm' ? 'primary' : 'secondary'} onClick={() => switchTheme('calm')}>تم آرامش</Button>
          </div>

          <TextField label="نام" placeholder="مثال: علی" helperText="این یک نمونه است" />
          <TextField label="شماره موبایل" placeholder="09123456789" errorText="فرمت شماره صحیح نیست" />
          <TextAreaField label="پیام" placeholder="متن پیام" helperText="حداقل 10 کاراکتر بنویسید" />
          <TextAreaField label="پیام با خطا" placeholder="..." errorText="متن پیام الزامی است" />

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button size="sm">اصلی کوچک</Button>
            <Button size="md">اصلی متوسط</Button>
            <Button size="lg">اصلی بزرگ</Button>
            <Button iconOnly aria-label="تنظیمات" title="تنظیمات"><Icon name="settings" size={18} aria-hidden="true" /></Button>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button>اصلی</Button>
            <Button variant="secondary">ثانویه</Button>
            <Button variant="ghost">شفاف</Button>
            <Button variant="danger">خطر</Button>
            <Button loading>بارگذاری</Button>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={() => setOpen(true)}>نمایش مودال</Button>
            <Button variant="secondary" onClick={() => notify.info('این یک پیام اطلاع‌رسانی است', { title: 'اطلاع' })}>
              Toast اطلاع
            </Button>
            <Button onClick={() => notify.success('عملیات با موفقیت انجام شد', { title: 'موفق' })}>
              Toast موفق
            </Button>
            <Button onClick={() => notify.warning('این کار ممکن است با ریسک همراه باشد', { title: 'هشدار' })}>
              Toast هشدار
            </Button>
            <Button variant="danger" onClick={() => notify.error('خطا در ذخیره اطلاعات', { title: 'خطا' })}>
              Toast خطا
            </Button>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={async () => {
              const ok = await confirm({ message: 'این عملیات انجام شود؟', confirmText: 'انجام', cancelText: 'لغو' });
              if (ok) notify.success('تایید شد');
            }}>
              Confirm
            </Button>
            <Button variant="secondary" onClick={async () => {
              const value = await prompt({ message: 'کد را وارد کنید', placeholder: 'مثال: 1234', confirmText: 'ارسال' });
              if (value) notify.info(`مقدار واردشده: ${value}`);
            }}>
              Prompt
            </Button>
          </div>
        </div>
      </Card>
      <Dialog open={open} title="نمونه مودال" onClose={() => setOpen(false)}>
        <p>این یک مودال نمونه برای بررسی دسترس پذیری است.</p>
      </Dialog>
    </div>
  );
}

function FormValidationExample() {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [errors, setErrors] = useState<{ name?: string; mobile?: string }>({});
  const [success, setSuccess] = useState(false);

  const validateMobile = (value: string) => {
    // Iranian mobile number: 09xx xxx xxxx
    const mobileRegex = /^09\d{9}$/;
    return mobileRegex.test(value.replace(/\s/g, ''));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: { name?: string; mobile?: string } = {};

    if (!name.trim()) {
      newErrors.name = 'نام الزامی است';
    }

    if (!mobile.trim()) {
      newErrors.mobile = 'شماره موبایل الزامی است';
    } else if (!validateMobile(mobile)) {
      newErrors.mobile = 'شماره موبایل معتبر نیست (مثال: 09123456789)';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
  };

  return (
    <Card style={{ marginBottom: '24px' }}>
      <h3 style={{ marginTop: 0 }}>نمونه فرم با اعتبارسنجی</h3>
      <form onSubmit={handleSubmit}>
        <FieldGroup direction="column">
          <TextField
            label="نام"
            value={name}
            onChange={(e) => setName(e.target.value)}
            errorText={errors.name}
            placeholder="نام خود را وارد کنید"
          />

          <TextField
            label="شماره موبایل"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="09123456789"
            dir="ltr"
          />

          {errors.mobile && (
            <InlineMessage text={errors.mobile} variant="error" />
          )}

          {success && (
            <InlineMessage text="اطلاعات با موفقیت ثبت شد" variant="success" />
          )}

          {!errors.mobile && !success && mobile && (
            <InlineMessage
              text="شماره موبایل باید با 09 شروع شود و 11 رقم باشد"
              variant="info"
            />
          )}

          <Button type="submit">ثبت اطلاعات</Button>
        </FieldGroup>
      </form>
    </Card>
  );
}

export default DesignSystemPreview;
