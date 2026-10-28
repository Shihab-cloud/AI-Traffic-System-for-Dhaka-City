/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';

import { Box, IconButton } from '@mui/material';
import { Icons } from '@/lib/icons';

interface MediaPreviewProps {
  media: File | string;
  isImage: boolean;
  height?: number;
  onRemoveClick: () => void;
}

/** An image or video with a floating remove control. Handles the object-URL lifecycle for Files. */
export default function MediaPreview({ media, isImage, height, onRemoveClick }: MediaPreviewProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (typeof media === 'string') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shares the object-URL lifecycle effect; string case sets src directly, File case creates/revokes a URL
      setSrc(media);
      return;
    }
    const url = URL.createObjectURL(media);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);

  if (!src) return null;

  return (
    <Box sx={{ position: 'relative', width: 'fit-content' }}>
      {isImage ? (
        <img src={src} alt="preview" style={{ borderRadius: 8, objectFit: 'cover', height }} />
      ) : (
        <video controls style={{ aspectRatio: '16 / 9', width: '100%', borderRadius: 8 }}>
          <source src={src} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      )}
      <IconButton
        onClick={onRemoveClick}
        aria-label="Remove media"
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
          bgcolor: 'error.main',
          color: 'error.contrastText',
          boxShadow: 1,
          '&:hover': { bgcolor: 'error.dark' },
        }}
      >
        <Icons.remove size={20} />
      </IconButton>
    </Box>
  );
}
