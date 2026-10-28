'use client';

import { ModalHookLayout } from '@/components/common/modal/ModalLayout';
import useNotificationAction from '@/hooks/actions/useNotificationAction';
import type { BroadcastNotificationRequest } from '@/lib/dtos/request/broadcast-notification.req';
import { DOCUMENT_TYPE_OPTIONS } from '@/lib/enum-config/document-type-config';
import {
  BROADCAST_MESSAGE_MAX_LENGTH,
  BroadcastNotificationValidation,
} from '@/lib/validators/broadcast-notification.validator';
import { useModal } from '@ebay/nice-modal-react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Box,
  Button,
  CircularProgress,
  DialogContentText,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { Controller, useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Icons } from '@/lib/icons';

/** What the confirmation dialog tells the sender they are about to reach. */
const AUDIENCE_DESCRIPTION = 'every user on the platform';

/**
 * Announcement composer.
 *
 * Writes to POST /notifications/broadcast (backend internal path kept for
 * backwards compatibility — the user-facing concept is "announcement").
 * Confirmation is generic: we deliberately avoid a recipient-count roundtrip,
 * since the backend enqueues the fan-out asynchronously and any number shown
 * here would be a guess.
 *
 * **The whole form lives in react-hook-form**, including the deep-link target. It
 * used to be half `useState`, which meant `reset()` cleared the message and left
 * the target behind on the next announcement, and the submit handler had to cast
 * a loose string back onto the request type the validator already describes.
 */
export default function AnnouncementComposer() {
  const modal = useModal(ModalHookLayout);
  const { broadcastMutation } = useNotificationAction();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<BroadcastNotificationRequest>({
    resolver: zodResolver(BroadcastNotificationValidation),
    defaultValues: { message: '', documentType: undefined },
  });

  const message = useWatch({ control, name: 'message' }) ?? '';
  const remaining = BROADCAST_MESSAGE_MAX_LENGTH - message.length;

  const send = (closeModal: () => void) =>
    handleSubmit((data) => {
      broadcastMutation.mutate(data, {
        onSuccess: () => {
          // The only success toast for this flow — the hook deliberately raises none.
          toast.success('Announcement queued');
          reset();
          closeModal();
        },
      });
    })();

  const confirmSend = () =>
    modal.show({
      title: 'Send this announcement?',
      autoCloseOnConfirm: false,
      slotProps: {
        cancel: { text: 'Cancel' },
        confirm: { text: 'Send', onClick: (_, closeModal) => send(closeModal) },
      },
      children: (
        <DialogContentText>
          This will send a notification to {AUDIENCE_DESCRIPTION}. Continue?
        </DialogContentText>
      ),
    });

  return (
    <Paper variant="outlined">
      <Typography variant="body1" sx={{ color: 'text.secondary', p: 2, fontWeight: 600 }}>
        Send an announcement to all users on the platform.
      </Typography>

      <Divider />

      <Stack sx={{ gap: 2, p: 2 }}>
        <TextField
          label="Message"
          multiline
          minRows={4}
          {...register('message')}
          helperText={errors.message?.message ?? `${remaining} characters remaining`}
          error={!!errors.message}
        />

        <Controller
          control={control}
          name="documentType"
          render={({ field }) => (
            <TextField
              select
              label="Deep-link target (optional)"
              helperText="Routes mobile tap to a specific screen"
              // The field is optional, so "None" is the absence of a value rather
              // than a value of its own — MUI needs '' to render an empty select
              // either way.
              value={field.value ?? ''}
              onChange={(e) =>
                field.onChange(
                  (e.target.value as BroadcastNotificationRequest['documentType']) || undefined,
                )
              }
              onBlur={field.onBlur}
              inputRef={field.ref}
            >
              <MenuItem value="">None</MenuItem>
              {DOCUMENT_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
        />

        <AnnouncementPreview message={message} />

        <Button
          variant="contained"
          disabled={broadcastMutation.isPending}
          onClick={confirmSend}
          sx={{ alignSelf: 'flex-end' }}
        >
          {broadcastMutation.isPending ? <CircularProgress size={18} /> : 'Send announcement'}
        </Button>
      </Stack>
    </Paper>
  );
}

/** How the announcement will read to a recipient, or a prompt while it is still empty. */
function AnnouncementPreview({ message }: { message: string }) {
  const trimmed = message.trim();

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 1.5,
        px: 2,
        py: 1.5,
        bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
        borderColor: (t) => alpha(t.palette.primary.main, 0.2),
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
      }}
    >
      <Icons.announcement size={18} style={{ marginTop: 2 }} />

      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Preview</Typography>
        <Typography
          sx={{
            fontSize: 13,
            color: 'text.secondary',
            mt: 0.5,
            // Preserves the line breaks the sender typed, which is how the
            // message actually ships.
            whiteSpace: 'pre-wrap',
          }}
        >
          {trimmed || 'Recipients will see the message you type above.'}
        </Typography>
      </Box>
    </Paper>
  );
}
