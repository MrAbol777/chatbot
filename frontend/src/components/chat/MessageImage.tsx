import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { fetchProtectedImageBlobUrl } from '../../services/imageGeneration';
import type { ImagePreviewState } from '../../types/chat.types';

export const withImageRetryParam = (src: string, retry: number): string => {
  if (retry <= 0) {
    return src;
  }

  try {
    const url = new URL(src, window.location.origin);
    url.searchParams.set('retry', String(retry));
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}retry=${retry}`;
  }
};

export const buildImageDownloadName = (src: string, index?: number): string => {
  const suffix = typeof index === 'number' ? `-${index + 1}` : '';
  try {
    const url = new URL(src, window.location.origin);
    const fileName = url.pathname.split('/').filter(Boolean).pop();
    if (fileName && fileName.includes('.')) {
      return fileName;
    }
  } catch {
    // Keep the friendly fallback below for relative or blob URLs.
  }
  return `danoa-image${suffix}.jpg`;
};

export interface MessageImageProps {
  src: string;
  alt: string;
  index?: number;
  onOpenPreview: (image: ImagePreviewState) => void;
}

export const MessageImage: React.FC<MessageImageProps> = ({
  src,
  alt,
  index,
  onOpenPreview
}) => {
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const protectedBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setRetryCount(0);
    setFailed(false);
    setResolvedSrc(src);
    if (protectedBlobUrlRef.current) {
      URL.revokeObjectURL(protectedBlobUrlRef.current);
      protectedBlobUrlRef.current = null;
    }

    if (
      !src.startsWith('/api/images/result/') &&
      !src.startsWith('/api/images/serve/') &&
      !src.startsWith('/api/uploads/images/')
    ) {
      return;
    }

    let cancelled = false;
    fetchProtectedImageBlobUrl(src)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        protectedBlobUrlRef.current = blobUrl;
        setResolvedSrc(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (protectedBlobUrlRef.current) {
        URL.revokeObjectURL(protectedBlobUrlRef.current);
        protectedBlobUrlRef.current = null;
      }
    };
  }, [src]);

  if (failed) {
    return (
      <div className="image-load-error">
        <Icon name="info-circle" size="1.1em" aria-hidden="true" /> خطا در بارگذاری تصویر — لطفاً دوباره تلاش کنید
      </div>
    );
  }

  const displaySrc = resolvedSrc.startsWith('blob:') ? resolvedSrc : withImageRetryParam(resolvedSrc, retryCount);
  const downloadName = buildImageDownloadName(src, index);

  return (
    <figure className="generated-image-card">
      <button
        type="button"
        className="generated-image-preview"
        onClick={() => onOpenPreview({ src: displaySrc, alt, downloadName })}
        aria-label="مشاهده تصویر"
      >
        <img
          className="message-image"
          src={displaySrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (retryCount >= 5) {
              setFailed(true);
              return;
            }

            window.setTimeout(() => {
              setRetryCount((current) => current + 1);
            }, 700 + retryCount * 500);
          }}
        />
        <span className="generated-image-hover" aria-hidden="true">
          <span>مشاهده</span>
        </span>
      </button>
      <figcaption className="generated-image-actions">
        <span className="generated-image-label">تصویر آماده شد</span>
        <a className="generated-image-download" href={displaySrc} download={downloadName}>
          دانلود
        </a>
      </figcaption>
    </figure>
  );
};

export default MessageImage;
