import { type DragEvent, useCallback } from 'react';
import Icon from '../components/Icon';
import type { MultiImageState } from './video-generation.types';

type Props = {
  images: MultiImageState[];
  uploading: boolean;
  onFilesAdded: (files: File[]) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
  onReorder: (localId: string, direction: -1 | 1) => void;
  disabled: boolean;
  maxCount: number;
};

const faNumber = (value: number) => value.toLocaleString('fa-IR');
const kb = (bytes?: number | null) => bytes ? `${faNumber(Math.round(bytes / 1024))} کیلوبایت` : '';

export default function MultiImageUploader(props: Props) {
  const { images, disabled, maxCount } = props;
  const hasError = images.some((img) => img.uploadStatus === 'error');
  const canAdd = images.length < maxCount && !disabled;

  const handleDrop = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!canAdd) return;
    const files = Array.from(event.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) props.onFilesAdded(files);
  }, [canAdd, props]);

  const singleImage = images.length === 1;
  const image = singleImage ? images[0] : null;

  return (
    <div className="video-media-field">
      <div className="video-media-field__heading">
        <label htmlFor="video-input-media">تصاویر ورودی خصوصی <b aria-hidden="true">*</b></label>
        <span>{images.length} / {maxCount} تصویر</span>
      </div>

      {/* Drop zone */}
      {canAdd && (
        <>
          <input
            className="video-upload-input"
            id="video-input-media"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []).filter((f) => f.type.startsWith('image/'));
              event.currentTarget.value = '';
              if (files.length) props.onFilesAdded(files);
            }}
          />
          <label
            htmlFor="video-input-media"
            className={`video-upload-dropzone${disabled ? ' is-disabled' : ''}`}
            aria-disabled={disabled}
            onDragEnter={(e) => e.preventDefault()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <span className="video-upload-dropzone__icon" aria-hidden="true"><Icon name="upload" size="1.6em" /></span>
            <strong>{props.uploading ? 'در حال بارگذاری تصاویر…' : 'تصاویر را اینجا رها کنید'}</strong>
            <span>{props.uploading ? 'چند لحظه صبر کنید' : 'یا برای انتخاب فایل کلیک کنید'}</span>
            <span className="video-upload-dropzone__formats"><b>JPG</b><b>PNG</b><b>WEBP</b><small>حداکثر ۵ مگابایت</small></span>
          </label>
        </>
      )}

      {/* Single image preview (legacy UX) */}
      {singleImage && image && (
        <div className="video-media-preview">
          <div className="video-media-preview__visual">
            {image.previewUrl ? <img src={image.previewUrl} alt={`پیش‌نمایش ${image.fileName}`} /> : <Icon name="studio-image" size="2.4em" aria-hidden="true" />}
            {image.uploadStatus === 'ready' && <span aria-hidden="true"><Icon name="check" size="1em" /></span>}
            {image.uploadStatus === 'error' && <span className="video-media-preview__error-badge" aria-hidden="true">!</span>}
          </div>
          <div className="video-media-preview__copy">
            <strong title={image.fileName}>{image.fileName || 'تصویر ورودی'}</strong>
            {image.uploadStatus === 'ready' && <small>{kb(image.sizeBytes)} · آماده</small>}
            {image.uploadStatus === 'uploading' && <small className="video-media-field__uploading">در حال بارگذاری…</small>}
            {image.uploadStatus === 'error' && <small className="video-media-field__error-text">{image.uploadError || 'خطا در بارگذاری'}</small>}
          </div>
          <div className="video-media-preview__actions">
            {canAdd && <label htmlFor="video-input-media" aria-disabled={disabled}><Icon name="upload" size="1em" aria-hidden="true" /> افزودن تصویر</label>}
            <button type="button" onClick={() => image.uploadStatus === 'error' ? props.onRetry(image.localId) : props.onRemove(image.localId)} disabled={disabled} title={image.uploadStatus === 'error' ? 'تلاش دوباره' : 'حذف'}>
              <Icon name="delete" size="1em" aria-hidden="true" />
              {image.uploadStatus === 'error' ? 'تلاش دوباره' : 'حذف'}
            </button>
          </div>
        </div>
      )}

      {/* Multi-image grid */}
      {images.length >= 2 && (
        <div className="video-multi-grid" role="list" aria-label="تصاویر انتخاب‌شده">
          {images.map((img, index) => (
            <div key={img.localId} className={`video-multi-item${img.uploadStatus === 'ready' ? ' is-ready' : ''}${img.uploadStatus === 'error' ? ' is-error' : ''}${img.uploadStatus === 'uploading' ? ' is-uploading' : ''}`} role="listitem">
              <span className="video-multi-item__order" aria-label={`تصویر ${faNumber(index + 1)} از ${faNumber(images.length)}`}>{faNumber(index + 1)}</span>
              <div className="video-multi-item__visual">
                {img.previewUrl ? <img src={img.previewUrl} alt={img.fileName} /> : <Icon name="studio-image" size="1.4em" aria-hidden="true" />}
                {img.uploadStatus === 'uploading' && <span className="video-multi-item__spinner" aria-label="در حال بارگذاری" />}
                {img.uploadStatus === 'error' && <span className="video-multi-item__error-icon" aria-label="خطا در بارگذاری">!</span>}
              </div>
              <div className="video-multi-item__info">
                <strong title={img.fileName}>{img.fileName || `تصویر ${faNumber(index + 1)}`}</strong>
                {img.uploadStatus === 'ready' && <small className="video-multi-item__ready">{kb(img.sizeBytes)}</small>}
                {img.uploadStatus === 'error' && <small className="video-multi-item__error-msg">{img.uploadError || 'بارگذاری ناموفق'}</small>}
              </div>
              <div className="video-multi-item__actions">
                {img.uploadStatus === 'error' ? (
                  <button type="button" onClick={() => props.onRetry(img.localId)} aria-label="تلاش دوباره برای بارگذاری" title="تلاش دوباره">↻</button>
                ) : (
                  <button type="button" onClick={() => props.onRemove(img.localId)} aria-label={`حذف ${img.fileName || 'تصویر'}`} title="حذف" disabled={disabled}>✕</button>
                )}
              </div>
              <div className="video-multi-item__reorder" role="group" aria-label="ترتیب تصاویر">
                <button type="button" onClick={() => props.onReorder(img.localId, -1)} aria-label={`انتقال ${img.fileName || 'تصویر'} به جلو`} disabled={disabled || index === 0} title="جلوتر">&#9664;</button>
                <button type="button" onClick={() => props.onReorder(img.localId, 1)} aria-label={`انتقال ${img.fileName || 'تصویر'} به عقب`} disabled={disabled || index === images.length - 1} title="عقب‌تر">&#9654;</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      {canAdd && images.length < maxCount && images.length === 0 && (
        <small className="video-media-field__help">فایل‌ها فقط برای ساخت ویدیو استفاده می‌شوند؛ JPEG، PNG یا WebP. می‌توانید تا {maxCount} تصویر انتخاب کنید.</small>
      )}
      {images.length >= 1 && !canAdd && (
        <small className="video-media-field__help">حداکثر {maxCount} تصویر مجاز است. برای افزودن تصویر جدید، ابتدا یکی را حذف کنید.</small>
      )}
      {hasError && (
        <p role="alert" className="video-prompt-error">برخی تصاویر با خطا مواجه شدند. می‌توانید دوباره تلاش کنید یا آنها را حذف نمایید.</p>
      )}
    </div>
  );
}
