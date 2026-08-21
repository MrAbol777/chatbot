import React from 'react';
import Icon from '../Icon';
import type { ImageAttachment } from '../../types/chat.types';

export interface ImageAttachmentListProps {
  attachments: ImageAttachment[];
  onRetryUpload: (id: string) => void;
  onRemoveAttachment: (id: string) => void;
}

export const ImageAttachmentList: React.FC<ImageAttachmentListProps> = ({
  attachments,
  onRetryUpload,
  onRemoveAttachment
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className="image-thumb-grid">
      {attachments.map((attachment) => (
        <div className="image-thumb-wrap" key={attachment.id}>
          <div className="image-thumb-meta">
            <img className="image-thumb" src={attachment.previewUrl} alt={attachment.file.name} />
            <div className="image-thumb-copy">
              <strong>{attachment.file.name}</strong>
              <span>وضعیت: {attachment.status}</span>
              {attachment.error ? <span>{attachment.error}</span> : null}
            </div>
          </div>
          <div className="image-thumb-actions">
            {attachment.status === 'error' ? (
              <button
                className="retry-thumb-btn"
                type="button"
                onClick={() => onRetryUpload(attachment.id)}
              >
                تلاش مجدد
              </button>
            ) : null}
            <button
              className="remove-thumb-btn"
              type="button"
              aria-label="حذف تصویر"
              onClick={() => onRemoveAttachment(attachment.id)}
            >
              <Icon name="x-close" size="1em" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ImageAttachmentList;
