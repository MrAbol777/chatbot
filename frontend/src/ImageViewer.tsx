import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchProtectedImageBlobUrl, GalleryImage } from './services/imageGeneration';
import './ImageViewer.css';

interface ImageViewerProps {
  item: GalleryImage;
  onClose: () => void;
  onDownload: (item: GalleryImage) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.5;

function ImageViewer({ item, onClose, onDownload }: ImageViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [blobUrl, setBlobUrl] = useState('');
  const [scale, setScale] = useState(MIN_SCALE);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const initialPinchDistance = useRef(0);
  const initialPinchScale = useRef(MIN_SCALE);
  const initialPinchTranslate = useRef({ x: 0, y: 0 });
  const createdBlobUrl = useRef('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setScale(MIN_SCALE);
    setTranslate({ x: 0, y: 0 });

    if (!item.imageUrl) {
      setError(true);
      setLoading(false);
      return;
    }

    fetchProtectedImageBlobUrl(item.imageUrl)
      .then((url) => {
        if (!active) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        createdBlobUrl.current = url;
        setBlobUrl(url);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
      if (createdBlobUrl.current && createdBlobUrl.current.startsWith('blob:')) {
        URL.revokeObjectURL(createdBlobUrl.current);
        createdBlobUrl.current = '';
      }
    };
  }, [item.id, item.imageUrl]);

  const handleImageLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const zoomAt = useCallback((newScale: number, cx: number, cy: number) => {
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const ratio = clampedScale / scale;
    setScale(clampedScale);
    setTranslate((prev) => ({
      x: cx - ratio * (cx - prev.x),
      y: cy - ratio * (cy - prev.y),
    }));
  }, [scale]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const direction = e.deltaY < 0 ? 1 : -1;
    zoomAt(scale + direction * ZOOM_STEP * 0.5, cx, cy);
  }, [scale, zoomAt]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (scale > MIN_SCALE + 0.1) {
      setScale(MIN_SCALE);
      setTranslate({ x: 0, y: 0 });
    } else {
      zoomAt(MIN_SCALE + 2, cx, cy);
    }
  }, [scale, zoomAt]);

  const resetZoom = useCallback(() => {
    setScale(MIN_SCALE);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) { setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP)); return; }
    zoomAt(scale + ZOOM_STEP, rect.width / 2, rect.height / 2);
  }, [scale, zoomAt]);

  const zoomOut = useCallback(() => {
    if (scale <= MIN_SCALE) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) { setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP)); return; }
    zoomAt(Math.max(MIN_SCALE, scale - ZOOM_STEP), rect.width / 2, rect.height / 2);
  }, [scale, zoomAt]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= MIN_SCALE + 0.01) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale, translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTranslate({
      x: translateStart.current.x + dx,
      y: translateStart.current.y + dy,
    });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const getTouchCenter = (touches: React.TouchList) => {
    if (touches.length < 2) return { x: 0, y: 0 };
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
      y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
    };
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      initialPinchDistance.current = getTouchDistance(e.touches);
      initialPinchScale.current = scale;
      initialPinchTranslate.current = { ...translate };
    }
  }, [scale, translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      if (initialPinchDistance.current > 0) {
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, initialPinchScale.current * (currentDistance / initialPinchDistance.current)));
        const center = getTouchCenter(e.touches);
        const ratio = newScale / (initialPinchScale.current || 1);
        setScale(newScale);
        setTranslate({
          x: center.x - ratio * (center.x - initialPinchTranslate.current.x),
          y: center.y - ratio * (center.y - initialPinchTranslate.current.y),
        });
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    initialPinchDistance.current = 0;
    if (scale <= MIN_SCALE + 0.01) {
      setTranslate({ x: 0, y: 0 });
    }
  }, [scale]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleRetry = useCallback(() => {
    if (!item.imageUrl) return;
    setLoading(true);
    setError(false);
    fetchProtectedImageBlobUrl(item.imageUrl)
      .then((url) => {
        if (createdBlobUrl.current && createdBlobUrl.current.startsWith('blob:')) URL.revokeObjectURL(createdBlobUrl.current);
        createdBlobUrl.current = url;
        setBlobUrl(url);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [item.imageUrl]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
      if (e.key === '0') { e.preventDefault(); resetZoom(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, zoomIn, zoomOut, resetZoom]);

  const mountTarget = document.getElementById('modal-root') || document.body;

  return createPortal(
    <div className="image-viewer-root" role="dialog" aria-modal="true" aria-label="نمایش تصویر" onMouseDown={handleBackdropClick}>
      <div className="image-viewer-backdrop" />
      <div className="image-viewer-dialog">
        <div className="image-viewer-toolbar">
          <button className="image-viewer-btn" type="button" onClick={zoomIn} aria-label="بزرگنمایی" title="بزرگنمایی">
            <svg viewBox="0 0 24 24"><path d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5h-2Z" /></svg>
          </button>
          <button className="image-viewer-btn" type="button" onClick={zoomOut} aria-label="کوچک‌نمایی" title="کوچک‌نمایی">
            <svg viewBox="0 0 24 24"><path d="M5 11v2h14v-2H5Z" /></svg>
          </button>
          <button className="image-viewer-btn" type="button" onClick={resetZoom} aria-label="بازنشانی زوم" title="بازنشانی زوم">
            <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm8-5v5l3 3" /></svg>
          </button>
          <div className="image-viewer-spacer" />
          <button className="image-viewer-btn" type="button" onClick={() => { onDownload(item); }} aria-label="دانلود تصویر" title="دانلود">
            <svg viewBox="0 0 24 24"><path d="M12 15l-4-4h3V4h2v7h3l-4 4Zm-7 4v2h14v-2H5Z" /></svg>
          </button>
          <button className="image-viewer-btn image-viewer-close" type="button" onClick={onClose} aria-label="بستن" title="بستن">×</button>
        </div>
        <div
          ref={stageRef}
          className="image-viewer-stage"
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {loading && (
            <div className="image-viewer-loading" aria-label="در حال بارگذاری تصویر">
              <span className="image-viewer-spinner" />
              <span>در حال بارگذاری...</span>
            </div>
          )}
          {error && (
            <div className="image-viewer-error" role="alert">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" /></svg>
              <strong>نمایش تصویر ممکن نشد</strong>
              <p>تصویر در دسترس نیست یا بارگذاری آن با خطا مواجه شد.</p>
              <div className="image-viewer-error-actions">
                <button type="button" onClick={handleRetry}>تلاش دوباره</button>
                <button type="button" onClick={onClose}>بستن</button>
              </div>
            </div>
          )}
          {!loading && !error && blobUrl && (
            <img
              ref={imgRef}
              src={blobUrl}
              alt={item.originalPrompt || 'تصویر'}
              className="image-viewer-image"
              style={{
                transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                cursor: scale > MIN_SCALE + 0.01 ? 'grab' : 'default',
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
              draggable={false}
            />
          )}
          {!loading && !error && !blobUrl && (
            <div className="image-viewer-error" role="alert">
              <strong>تصویر در دسترس نیست</strong>
              <p>لینک تصویر معتبر نیست.</p>
              <div className="image-viewer-error-actions">
                <button type="button" onClick={onClose}>بستن</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    mountTarget
  );
}

export default ImageViewer;
