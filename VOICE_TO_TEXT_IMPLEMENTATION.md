# راهنمای پیاده‌سازی تبدیل گفتار فارسی به متن در مرورگر

این سند الگوی قابلیت «دکمهٔ میکروفن → گفتار فارسی → متن قابل ویرایش» را توضیح می‌دهد. در این روش فایل صوتی به سرور سایت ارسال نمی‌شود؛ تشخیص گفتار با Web Speech API مرورگر انجام می‌شود.

## رفتار مورد انتظار

1. وقتی کادر پیام خالی است، به‌جای دکمهٔ ارسال، دکمهٔ میکروفن نشان داده شود.
2. با کلیک کاربر، اجازهٔ دسترسی به میکروفن درخواست شود.
3. گفتار فارسی تشخیص داده و نتیجه‌های نهایی در حافظه جمع شوند.
4. هنگام ضبط، ورودی متن غیرفعال باشد و دکمه‌های «تایید» و «لغو» نمایش داده شوند.
5. با «تایید»، متن تشخیص‌داده‌شده در ورودی پیام قرار گیرد؛ **پیام خودکار ارسال نشود** تا کاربر بتواند متن را اصلاح و سپس ارسال کند.
6. با «لغو»، متن موقت پاک و میکروفن متوقف شود.
7. در صورت پشتیبانی‌نشدن مرورگر یا ردشدن مجوز، پیام راهنمای فارسی نمایش داده شود.

## پیش‌نیازها و محدودیت‌ها

- سایت باید با HTTPS اجرا شود (به‌جز `localhost`)؛ دسترسی به میکروفن در HTTP معمولاً مجاز نیست.
- این قابلیت به `SpeechRecognition` یا `webkitSpeechRecognition` وابسته است. پشتیبانی مرورگرها یکسان نیست و در برخی مرورگرها/نسخه‌ها ممکن است در دسترس نباشد.
- مرورگر یا موتور تشخیص گفتارِ آن ممکن است برای تبدیل گفتار از سرویس خودش استفاده کند. این موضوع را در سیاست حریم خصوصی سایت بررسی و شفاف‌سازی کنید.
- این الگو فقط متن را به برنامه تحویل می‌دهد و فایل صوتی را ذخیره، آپلود یا به بک‌اند ارسال نمی‌کند.
- برای تشخیص گفتار آفلاین، کنترل کامل داده‌ها یا پشتیبانی یکنواخت در همهٔ مرورگرها، باید یک سرویس سمت‌سرور/مدل تبدیل گفتار جداگانه طراحی شود؛ آن مسیر با این الگو متفاوت است.

## منطق اصلی

### 1) تعریف نوع‌ها و state

نمونهٔ زیر با React و TypeScript است. در JavaScript می‌توان typeها را حذف کرد.

```ts
type RecordingAction = 'idle' | 'confirm' | 'cancel';

const [inputValue, setInputValue] = useState('');
const [isRecording, setIsRecording] = useState(false);

const recognitionRef = useRef<SpeechRecognition | null>(null);
const micStreamRef = useRef<MediaStream | null>(null);
const transcriptRef = useRef('');
const recordingActionRef = useRef<RecordingAction>('idle');
const keepRecordingRef = useRef(false);
```

اگر TypeScript به‌صورت پیش‌فرض این API را نمی‌شناسد، declaration زیر را به فایل typeهای سراسری اضافه کنید:

```ts
interface Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
```

### 2) آزاد کردن میکروفن

بعد از پایان، لغو، خطا یا unmount شدن کامپوننت، trackهای میکروفن را ببندید:

```ts
const releaseMicStream = () => {
  micStreamRef.current?.getTracks().forEach((track) => track.stop());
  micStreamRef.current = null;
};
```

### 3) درخواست مجوز میکروفن

```ts
const requestMicrophoneAccess = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('MEDIA_DEVICES_UNSUPPORTED');
  }

  releaseMicStream();
  micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
};
```

### 4) ساخت و مدیریت Speech Recognition

این effect فقط یک‌بار recognizer را می‌سازد. `fa-IR` زبان فارسی را انتخاب می‌کند، `continuous` ضبط را پس از پایان قطعهٔ گفتار ادامه می‌دهد و `interimResults: false` فقط نتایج نهایی را می‌گیرد.

```ts
useEffect(() => {
  const SpeechRecognitionApi =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;

  if (!SpeechRecognitionApi) return;

  const recognition = new SpeechRecognitionApi();
  recognition.lang = 'fa-IR';
  recognition.interimResults = false;
  recognition.continuous = true;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        transcriptRef.current += result[0].transcript;
      }
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    keepRecordingRef.current = false;
    recordingActionRef.current = 'cancel';
    setIsRecording(false);
    releaseMicStream();

    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showToast('اجازه دسترسی به میکروفن داده نشد. دسترسی میکروفن را در مرورگر فعال کنید.');
    } else {
      showToast('دسترسی به میکروفن برقرار نشد. لطفاً دوباره تلاش کنید.');
    }
  };

  recognition.onend = () => {
    // بعضی مرورگرها recognition را پس از هر قطعه گفتار می‌بندند.
    // تا وقتی کاربر پایان را انتخاب نکرده، مجدداً آن را شروع می‌کنیم.
    if (recordingActionRef.current === 'idle' && keepRecordingRef.current) {
      try {
        recognition.start();
        return;
      } catch {
        keepRecordingRef.current = false;
        setIsRecording(false);
        releaseMicStream();
        showToast('ضبط برای مدت طولانی ادامه پیدا نکرد. دوباره تلاش کنید.');
        return;
      }
    }

    const action = recordingActionRef.current;
    const transcript = transcriptRef.current.trim();
    keepRecordingRef.current = false;
    recordingActionRef.current = 'idle';
    setIsRecording(false);
    releaseMicStream();

    if (action === 'confirm' && transcript) {
      setInputValue(transcript);
      // در این نقطه پیام را ارسال نکنید؛ کاربر باید آن را بازبینی کند.
    }

    if (action === 'cancel') {
      transcriptRef.current = '';
      setInputValue('');
    }
  };

  recognitionRef.current = recognition;

  return () => {
    keepRecordingRef.current = false;
    recognition.stop();
    releaseMicStream();
    recognitionRef.current = null;
  };
}, []);
```

> `showToast` در نمونه، هر تابع نمایش اعلان در رابط کاربری شماست.

### 5) handlerهای شروع، تایید و لغو

```ts
const handleStartRecording = async () => {
  if (!recognitionRef.current) {
    showToast('مرورگر شما از تبدیل گفتار به متن پشتیبانی نمی‌کند.');
    return;
  }

  try {
    await requestMicrophoneAccess();
    recordingActionRef.current = 'idle';
    transcriptRef.current = '';
    keepRecordingRef.current = true;
    setIsRecording(true);
    recognitionRef.current.start();
  } catch (error) {
    keepRecordingRef.current = false;
    releaseMicStream();
    setIsRecording(false);

    const denied = error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError');
    showToast(
      denied
        ? 'اجازه دسترسی به میکروفن داده نشد. دسترسی میکروفن را فعال کنید.'
        : 'فعلاً نتوانستیم ضبط را شروع کنیم. دوباره امتحان کنید.'
    );
  }
};

const handleConfirmRecording = () => {
  if (!recognitionRef.current) return;
  recordingActionRef.current = 'confirm';
  keepRecordingRef.current = false;
  recognitionRef.current.stop();
};

const handleCancelRecording = () => {
  if (!recognitionRef.current) return;
  recordingActionRef.current = 'cancel';
  keepRecordingRef.current = false;
  recognitionRef.current.stop();
  releaseMicStream();
};
```

## نمونهٔ رابط کاربری

```tsx
<textarea
  value={inputValue}
  disabled={isRecording}
  onChange={(event) => setInputValue(event.target.value)}
  placeholder={isRecording ? 'در حال ضبط صدا...' : 'پیام خود را بنویسید...'}
/>

{isRecording ? (
  <>
    <button type="button" onClick={handleConfirmRecording}>تایید</button>
    <button type="button" onClick={handleCancelRecording}>لغو</button>
  </>
) : inputValue.trim() ? (
  <button type="button" onClick={handleSendMessage}>ارسال</button>
) : (
  <button type="button" onClick={handleStartRecording} aria-label="شروع ضبط صدا">
    میکروفن
  </button>
)}
```

پیشنهاد UX: در زمان ضبط، عبارت «ضبط صدا فعال است» و یک وضعیت بصری واضح (مثلاً تغییر رنگ دکمه/کادر) نشان دهید. همچنین در متن دکمهٔ تایید از واژهٔ «تایید» استفاده کنید، نه «ارسال»، چون این مرحله فقط متن را به کادر پیام منتقل می‌کند.

## سناریوهای تست پذیرش

- [ ] مرورگر برای نخستین استفاده، مجوز میکروفن درخواست می‌کند.
- [ ] گفتار فارسی بعد از تایید داخل کادر پیام ظاهر می‌شود و هنوز ارسال نشده است.
- [ ] کاربر می‌تواند متن تولیدشده را ویرایش و سپس ارسال کند.
- [ ] لغو، متن موقت را نگه نمی‌دارد و میکروفن را آزاد می‌کند.
- [ ] رد کردن مجوز میکروفن، پیام قابل‌فهم نمایش می‌دهد.
- [ ] مرورگر فاقد Web Speech API بدون خطای برنامه، پیام عدم پشتیبانی نشان می‌دهد.
- [ ] ترک صفحه هنگام ضبط باعث می‌شود trackهای میکروفن بسته شوند.
- [ ] در مرورگر هدف، ضبط طولانی با رخداد `onend` ناخواسته متوقف نمی‌شود یا پیام خطای مناسب نمایش می‌دهد.

## آنچه عمداً در این نسخه وجود ندارد

- آپلود یا ذخیرهٔ فایل صوتی
- endpoint بک‌اند برای تبدیل صدا به متن
- ارسال خودکار متن بعد از تایید
- تبدیل گفتار کاملاً آفلاین

اگر هرکدام از این موارد لازم است، پیش از پیاده‌سازی باید معماری جداگانه‌ای برای دریافت فایل صوتی، محدودیت حجم/مدت، امنیت، نگهداری داده و سرویس تبدیل گفتار تعریف شود.
