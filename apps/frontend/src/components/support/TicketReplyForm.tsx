'use client';

import useSupportFileUpload, { ALLOWED_TYPES, UploadSlot } from '@/hooks/useSupportFileUpload';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { MessageAttachmentRequest } from '@/lib/dtos/request/support.req';
import toast from 'react-hot-toast';
import { useEffect, useRef, useState } from 'react';
import { Icons } from '@/lib/icons';

interface TicketReplyFormProps {
  onReply: (content: string, attachments?: MessageAttachmentRequest[]) => void;
  loading?: boolean;
}

function SlotPreview({ slot, onRemove }: { slot: UploadSlot; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isImage = slot.file.type.startsWith('image/');
  const isVideo = slot.file.type.startsWith('video/');
  const isUploading = slot.state === 'uploading';

  useEffect(() => {
    if (!isImage && !isVideo) return;
    const url = URL.createObjectURL(slot.file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- holds an external object-URL resource that must be created here and revoked on cleanup; creating it during render would leak
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [slot.file, isImage, isVideo]);

  if (isImage || isVideo) {
    return (
      <Box sx={{ mt: 1 }}>
        {isUploading && (
          <Box sx={{ mb: 0.5 }}>
            <LinearProgress variant="determinate" value={slot.progress} />
            <Typography variant="caption" color="text.secondary">
              Uploading… {slot.progress}%
            </Typography>
          </Box>
        )}
        {previewUrl && (
          <Box sx={{ position: 'relative', display: 'inline-block' }}>
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element -- local object-URL (blob:) preview of a user-selected file; next/image cannot handle blob URLs
              <img
                src={previewUrl}
                alt="preview"
                style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, display: 'block' }}
              />
            )}
            {isVideo && (
              <video
                src={previewUrl}
                controls
                width={320}
                height={180}
                style={{
                  borderRadius: 6,
                  display: 'block',
                  objectFit: 'contain',
                  background: '#000',
                }}
              />
            )}
            <IconButton
              size="small"
              onClick={onRemove}
              sx={{
                position: 'absolute',
                top: 4,
                right: 4,
                bgcolor: 'rgba(0,0,0,0.55)',
                color: 'white',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                p: '2px',
              }}
            >
              <Icons.close size={14} />
            </IconButton>
          </Box>
        )}
        {slot.error && (
          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
            {slot.error}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      {isUploading && (
        <Box sx={{ mb: 0.5 }}>
          <LinearProgress variant="determinate" value={slot.progress} />
          <Typography variant="caption" color="text.secondary">
            Uploading… {slot.progress}%
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={slot.file.name}
          size="small"
          onDelete={onRemove}
          deleteIcon={<Icons.close size={14} />}
          color={slot.state === 'error' ? 'error' : 'default'}
        />
      </Box>
      {slot.error && (
        <Typography variant="caption" color="error" sx={{ display: 'block' }}>
          {slot.error}
        </Typography>
      )}
    </Box>
  );
}

export default function TicketReplyForm({ onReply, loading }: TicketReplyFormProps) {
  const [replyText, setReplyText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { slots, addFiles, removeSlot, reset, isUploading, uploadAll } = useSupportFileUpload();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) addFiles(files);
    e.target.value = '';
  };

  const canSend =
    !loading &&
    !isUploading &&
    (!!replyText.trim() || slots.some((s) => s.state === 'staged' || s.state === 'done'));

  const handleReply = async () => {
    if (!canSend) return;

    const { results, hasErrors } = await uploadAll();

    if (hasErrors) {
      toast.error('Some files failed to upload. Remove them before sending.');
      return;
    }

    onReply(replyText.trim(), results.length > 0 ? results : undefined);
    setReplyText('');
    reset();
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        Reply
      </Typography>
      <TextField
        fullWidth
        multiline
        rows={3}
        placeholder="Type your reply..."
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
      />

      {slots.map((slot) => (
        <SlotPreview key={slot.id} slot={slot} onRemove={() => removeSlot(slot.id)} />
      ))}

      {/* Compact inline composer — a button, not the full Dropzone. `accept` comes
          from the hook's own list so the picker and the validator cannot disagree. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          size="small"
          variant="outlined"
          startIcon={isUploading ? <CircularProgress size={14} /> : <Icons.attach size={14} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? 'Uploading…' : 'Attach files'}
        </Button>
        <Button variant="contained" onClick={handleReply} disabled={!canSend}>
          {loading ? 'Sending...' : 'Send Reply'}
        </Button>
      </div>
    </Paper>
  );
}
