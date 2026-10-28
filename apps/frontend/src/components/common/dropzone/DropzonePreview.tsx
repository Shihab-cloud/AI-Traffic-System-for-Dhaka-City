'use client';

import dynamic from 'next/dynamic';

import MediaPreview from './MediaPreview';

// Loaded on demand: SpreadsheetPreview pulls in SheetJS (~130KB gzip), which
// would otherwise land in the bundle of every route that renders a Dropzone,
// including the image and video variants that can never show it.
const SpreadsheetPreview = dynamic(() => import('./SpreadsheetPreview'), { ssr: false });

interface DropzonePreviewProps {
  variant: 'image' | 'video' | 'file';
  media: File | string | null;
  height?: number;
  onRemoveClick: () => void;
}

/** Routes the dropzone's selection to the right preview: sheet card for files, media otherwise. */
export default function DropzonePreview({
  media,
  variant,
  height,
  onRemoveClick,
}: DropzonePreviewProps) {
  if (!media) return null;

  if (variant === 'file') {
    if (typeof media === 'string') return null;
    return <SpreadsheetPreview file={media} onRemoveClick={onRemoveClick} />;
  }

  return (
    <MediaPreview
      media={media}
      isImage={variant === 'image'}
      height={height}
      onRemoveClick={onRemoveClick}
    />
  );
}
