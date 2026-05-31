import { Button, Card, Dialog, TextAreaField, TextField, useToast } from '../components';
import { useState } from 'react';

function DesignSystemPreview() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'energy' | 'calm'>('energy');
  const { pushToast } = useToast();

  const switchTheme = (nextTheme: 'energy' | 'calm') => {
    document.documentElement.setAttribute('data-theme', nextTheme);
    setTheme(nextTheme);
  };

  return (
    <div style={{ padding: '24px', direction: 'rtl' }}>
      <Card className="ds-demo-stack">
        <h1>پیش نمایش دیزاین سیستم</h1>
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
            <Button iconOnly aria-label="تنظیمات" title="تنظیمات">⚙️</Button>
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
            <Button variant="secondary" onClick={() => pushToast('نمونه پیام اطلاع رسانی')}>
              Toast پیش فرض
            </Button>
            <Button variant="danger" onClick={() => pushToast('خطا در ذخیره اطلاعات', 'danger')}>
              Toast خطا
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

export default DesignSystemPreview;
