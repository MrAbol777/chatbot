import { useState, useRef, useCallback } from 'react';
import { generateImageWithPolling, type ImageTaskStatus } from '../services/imageGeneration';

interface ImageGeneratorProps {
  /** Called with the final imageUrl when generation succeeds */
  onImageReady?: (url: string, prompt: string) => void;
  /** Called with the error message when generation fails */
  onError?: (error: string) => void;
  /** Custom class name for the root element */
  className?: string;
  /** Max length for the prompt input */
  maxPromptLength?: number;
}

type GenStatus = 'idle' | 'generating' | 'completed' | 'error';

export default function ImageGenerator({
  onImageReady,
  onError,
  className = '',
  maxPromptLength = 500
}: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<GenStatus>('idle');
  const [statusLabel, setStatusLabel] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || status === 'generating') return;

    abortRef.current = false;
    setStatus('generating');
    setStatusLabel('در حال ارسال درخواست...');
    setError(null);
    setImageUrl(null);

    try {
      const url = await generateImageWithPolling(trimmed, (s: ImageTaskStatus) => {
        if (abortRef.current) return;
        setStatusLabel(s === 'QUEUE' ? 'در صف انتظار...' : 'در حال ساخت عکس...');
      });

      if (abortRef.current) return;
      setImageUrl(url);
      setStatus('completed');
      setStatusLabel('');
      onImageReady?.(url, trimmed);
    } catch (err) {
      if (abortRef.current) return;
      const message = err instanceof Error ? err.message : 'خطای نامشخص در ساخت عکس';
      setError(message);
      setStatus('error');
      setStatusLabel('');
      onError?.(message);
    }
  }, [prompt, status, onImageReady, onError]);

  const handleCancel = useCallback(() => {
    abortRef.current = true;
    setStatus('idle');
    setStatusLabel('');
    setError(null);
  }, []);

  const handleReset = useCallback(() => {
    setPrompt('');
    setStatus('idle');
    setStatusLabel('');
    setImageUrl(null);
    setError(null);
    abortRef.current = false;
  }, []);

  const handleDownload = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `danoa-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: open in new tab if CORS blocks fetch
      window.open(imageUrl, '_blank');
    }
  }, [imageUrl]);

  const isGenerating = status === 'generating';
  const isCompleted = status === 'completed';
  const hasError = status === 'error';

  return (
    <div className={`image-generator ${className}`}>
      {/* Prompt input */}
      <div className="image-generator__input-group">
        <textarea
          className="image-generator__textarea"
          dir="auto"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="توضیح بده چه عکسی می‌خوای... مثلاً: یک گربه فضانورد روی ماه"
          disabled={isGenerating}
          rows={3}
          maxLength={maxPromptLength}
        />
        <div className="image-generator__input-footer">
          <span className="image-generator__char-count">
            {prompt.length} / {maxPromptLength}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="image-generator__actions">
        {isGenerating ? (
          <>
            <button className="image-generator__btn image-generator__btn--cancel" type="button" onClick={handleCancel}>
              لغو
            </button>
            <span className="image-generator__progress-text">{statusLabel}</span>
          </>
        ) : isCompleted ? (
          <>
            <button className="image-generator__btn image-generator__btn--download" type="button" onClick={handleDownload}>
              ⬇ دانلود عکس
            </button>
            <button className="image-generator__btn image-generator__btn--new" type="button" onClick={handleReset}>
              🎨 ساخت عکس جدید
            </button>
          </>
        ) : hasError ? (
          <>
            <button className="image-generator__btn image-generator__btn--retry" type="button" onClick={handleSubmit}>
              تلاش مجدد
            </button>
            <button className="image-generator__btn image-generator__btn--new" type="button" onClick={handleReset}>
              عکس جدید
            </button>
          </>
        ) : (
          <button
            className="image-generator__btn image-generator__btn--generate"
            type="button"
            onClick={handleSubmit}
            disabled={!prompt.trim()}
          >
            بساز 🎨
          </button>
        )}
      </div>

      {/* Progress indicator */}
      {isGenerating && (
        <div className="image-generator__status">
          <div className="image-generator__spinner" />
          <span>{statusLabel}</span>
        </div>
      )}

      {/* Error message */}
      {hasError && error && (
        <div className="image-generator__error" role="alert">
          <span className="image-generator__error-icon">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* Result image */}
      {isCompleted && imageUrl && (
        <div className="image-generator__result">
          <img
            className="image-generator__image"
            src={imageUrl}
            alt={prompt}
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
    </div>
  );
}
