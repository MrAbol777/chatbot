import { Button, Card, Dialog, TextAreaField, TextField } from '../components';
import { useState } from 'react';

function DesignSystemPreview() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: '24px', direction: 'rtl' }}>
      <Card className="ds-demo-stack">
        <h1>پیش نمایش دیزاین سیستم</h1>
        <div className="ds-demo-stack">
          <TextField label="نام" placeholder="مثال: علی" helperText="این یک نمونه است" />
          <TextAreaField label="پیام" placeholder="متن پیام" />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button>اصلی</Button>
            <Button variant="secondary">ثانویه</Button>
            <Button variant="ghost">شفاف</Button>
            <Button variant="danger">خطر</Button>
          </div>
          <Button onClick={() => setOpen(true)}>نمایش مودال</Button>
        </div>
      </Card>
      <Dialog open={open} title="نمونه مودال" onClose={() => setOpen(false)}>
        <p>این یک مودال نمونه برای بررسی دسترس پذیری است.</p>
      </Dialog>
    </div>
  );
}

export default DesignSystemPreview;
