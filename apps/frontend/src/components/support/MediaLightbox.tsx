import { SupportMessageFileResponse } from '@/lib/dtos/response/support.res';
import { Box, IconButton, Modal } from '@mui/material';
import { Icons } from '@/lib/icons';

interface MediaLightboxProps {
  open: boolean;
  onClose: () => void;
  attachment: SupportMessageFileResponse;
  isVideo: boolean;
}

export default function MediaLightbox({ open, onClose, attachment, isVideo }: MediaLightboxProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(0,0,0,0.85)',
        }}
        onClick={onClose}
      >
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            color: 'white',
            bgcolor: 'rgba(255,255,255,0.1)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
          }}
        >
          <Icons.close size={20} />
        </IconButton>

        <Box onClick={(e) => e.stopPropagation()}>
          {isVideo ? (
            <video
              src={attachment.url}
              controls
              autoPlay
              style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, display: 'block' }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded attachment served from arbitrary storage URLs; next/image loader is unsuitable here
            <img
              src={attachment.url}
              alt={attachment.fileName ?? 'attachment'}
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                borderRadius: 8,
                display: 'block',
                objectFit: 'contain',
              }}
            />
          )}
        </Box>
      </Box>
    </Modal>
  );
}
