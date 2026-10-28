import { SupportMessageFileResponse } from '@/lib/dtos/response/support.res';
import { Box, Link, Typography } from '@mui/material';
import { useState } from 'react';
import MediaLightbox from './MediaLightbox';
import { Icons } from '@/lib/icons';

interface Props {
  attachment: SupportMessageFileResponse;
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const VIDEO_EXTS = ['mp4', 'mov', 'webm'];

function getExt(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export default function MessageAttachment({ attachment }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const ext = getExt(attachment.fileName ?? '');
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);

  if (isImage) {
    return (
      <>
        <Box
          onClick={() => setLightboxOpen(true)}
          sx={{
            width: 240,
            height: 160,
            borderRadius: 1,
            overflow: 'hidden',
            flexShrink: 0,
            cursor: 'pointer',
            '&:hover': { opacity: 0.9 },
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded attachment served from arbitrary storage URLs; next/image loader is unsuitable here */}
          <img
            src={attachment.url}
            alt={attachment.fileName ?? 'attachment'}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </Box>
        <MediaLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          attachment={attachment}
          isVideo={false}
        />
      </>
    );
  }

  if (isVideo) {
    return (
      <>
        <Box
          onClick={() => setLightboxOpen(true)}
          sx={{ cursor: 'pointer', '&:hover': { opacity: 0.9 } }}
        >
          <video
            src={attachment.url}
            width={240}
            height={160}
            style={{
              borderRadius: 4,
              display: 'block',
              objectFit: 'contain',
              background: '#000',
              pointerEvents: 'none',
            }}
          />
        </Box>
        <MediaLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          attachment={attachment}
          isVideo={true}
        />
      </>
    );
  }

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 1.5,
        py: 0.75,
      }}
    >
      <Icons.file size={16} />
      <Link href={attachment.url} download={attachment.fileName ?? true} underline="hover">
        <Typography variant="caption">{attachment.fileName ?? 'Download attachment'}</Typography>
      </Link>
      <Icons.download size={14} />
    </Box>
  );
}
