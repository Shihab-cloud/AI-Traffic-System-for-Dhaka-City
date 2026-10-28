'use client';

import {
  Box,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { Controller, useFormContext } from 'react-hook-form';
import { CreateTicketRequest } from '@/lib/dtos/request/support.req';
import Dropzone from '@/components/common/dropzone/Dropzone';
import { ALLOWED_TYPES, MAX_SIZE_MB, UploadSlot } from '@/hooks/useSupportFileUpload';
import { useEffect, useState } from 'react';
import { Icons } from '@/lib/icons';

interface TicketCreateFormProps {
  hidePriority?: boolean;
  slots: UploadSlot[];
  addFiles: (files: File[]) => void;
  removeSlot: (id: string) => void;
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

/**
 * Field layout only. The surrounding `ModalLayout`'s Confirm button owns
 * submission — it needs the modal's `closeModal` — so there is no `<form>`
 * here promising an Enter-to-submit that goes nowhere.
 */
export default function TicketCreateForm({
  hidePriority = false,
  slots,
  addFiles,
  removeSlot,
}: TicketCreateFormProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<CreateTicketRequest>();
  const isUploading = slots.some((s) => s.state === 'uploading');

  return (
    <div className="flex flex-col gap-4">
      <Controller
        name="subject"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="Subject"
            fullWidth
            error={!!errors.subject}
            helperText={errors.subject?.message}
          />
        )}
      />
      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="Description"
            fullWidth
            multiline
            rows={4}
            error={!!errors.description}
            helperText={errors.description?.message}
          />
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Controller
          name="category"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              label="Category"
              fullWidth
              error={!!errors.category}
              helperText={errors.category?.message}
            >
              <MenuItem value="ACCOUNT_ACCESS">Account Access</MenuItem>
              <MenuItem value="BILLING">Billing</MenuItem>
              <MenuItem value="TECHNICAL">Technical</MenuItem>
              <MenuItem value="GENERAL">General</MenuItem>
              <MenuItem value="OTHER">Other</MenuItem>
            </TextField>
          )}
        />
        {!hidePriority && (
          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Priority"
                fullWidth
                error={!!errors.priority}
                helperText={errors.priority?.message}
              >
                <MenuItem value="LOW">Low</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
                <MenuItem value="CRITICAL">Critical</MenuItem>
              </TextField>
            )}
          />
        )}
      </div>

      {/* Drag-and-drop, with the slot list below keeping each file's own
          progress and error state. `multiple` hands the files straight to
          `addFiles`, which owns validation — duplicating the type and size
          rules here would mean two places to keep in step. */}
      <Dropzone
        multiple
        compact
        variant="file"
        acceptedTypes={ALLOWED_TYPES}
        onFiles={addFiles}
        disabled={isUploading}
        label="files"
        hint={
          isUploading ? 'Uploading…' : `Images, video, PDF or CSV — up to ${MAX_SIZE_MB}MB each`
        }
      />

      {slots.map((slot) => (
        <SlotPreview key={slot.id} slot={slot} onRemove={() => removeSlot(slot.id)} />
      ))}
    </div>
  );
}
