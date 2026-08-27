const DEFERRED_WORK_PATTERNS = [
  /(?:فقط\s*)?(?:چند|یک)\s*لحظه[^.!؟\n]{0,80}(?:صبر|زمان|فرصت|مهلت)/i,
  /(?:فقط\s*)?(?:چند|یک)\s*لحظه[^.!؟\n]{0,120}(?:آماده|انجام|بررسی|طراحی|ارسال|می[‌\s-]*فرستم)/i,
  /(?:منتظر|صبر)\s+(?:باش|بمان|کن)[^.!؟\n]{0,100}(?:آماده|انجام|بررسی|طراحی|ارسال)/i,
  /(?:بعداً|به[‌\s-]*زودی)[^.!؟\n]{0,100}(?:می[‌\s-]*(?:فرستم|دهم|نویسم|سازم|کنم))/i,
  /(?:give me|wait)\s+(?:a|one|few|some)?\s*(?:moment|minute|time)[^.!?\n]{0,100}(?:prepare|finish|send|create|work)/i
];

const isDeferredWorkReply = (value) => {
  const text = String(value || '').trim();
  return Boolean(text) && DEFERRED_WORK_PATTERNS.some((pattern) => pattern.test(text));
};

const buildImmediateCompletionMessages = (messages, rejectedReply) => {
  const source = Array.isArray(messages) ? messages : [];
  const next = source.map((message, index) => {
    if (index !== 0 || message?.role !== 'system' || typeof message.content !== 'string') return message;
    return {
      ...message,
      content: `${message.content}\n\nCRITICAL RESPONSE CONTRACT: Complete the user's requested work in this response. Never ask the user to wait and never claim that normal chat work continues in the background.`
    };
  });

  return [
    ...next,
    { role: 'assistant', content: String(rejectedReply || '').trim() },
    {
      role: 'user',
      content: 'پاسخ قبلی فقط وعدهٔ انجام کار در آینده بود و قابل قبول نیست. همان درخواست اصلی من را همین حالا کامل کن و نتیجهٔ واقعی را مستقیم بده؛ نگو منتظر بمانم و دوباره اجازه نگیر.'
    }
  ];
};

module.exports = {
  buildImmediateCompletionMessages,
  isDeferredWorkReply
};
