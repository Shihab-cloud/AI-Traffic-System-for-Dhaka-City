'use client';

import { FcmPermissionStateEnum } from '@/lib/enums/fcm-permission-state.enum';
import ModalLayout from '@/components/common/modal/ModalLayout';
import { useFcmRegistration } from '@/hooks/useFcmRegistration';
import { DialogContentText } from '@mui/material';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'push-auto-dialog-dismissed-at';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isCoolingDown(): boolean {
  if (typeof window === 'undefined') return true;
  const stamp = window.localStorage.getItem(STORAGE_KEY);
  if (!stamp) return false;
  const dismissedAt = Number(stamp);
  if (Number.isNaN(dismissedAt)) return false;
  return Date.now() - dismissedAt < COOLDOWN_MS;
}

/**
 * Auto-opening modal that prompts the signed-in user to enable browser push.
 *
 * Browsers require a user gesture for Notification.requestPermission(), so the
 * dialog provides the gesture: auto-shown UI, single click on the CTA fires
 * the real browser prompt via useFcmRegistration.enable(). Calling
 * requestPermission() without a fresh gesture is silently rejected (or worse,
 * trips Chrome's permission-abuse heuristics), so the dialog cannot skip
 * straight to the browser prompt.
 *
 * Renders nothing when FCM is unsupported, already granted, denied, or within
 * the post-dismissal cooldown. Re-shows after cooldown lapses.
 */
export default function EnablePushAutoDialog() {
  const { permission, enable } = useFcmRegistration();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (permission !== FcmPermissionStateEnum.DEFAULT) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to FCM `permission` changes and reads localStorage cooldown; `open` is also toggled by dismiss/enable handlers, so it can't be derived during render
      setOpen(false);
      return;
    }
    setOpen(!isCoolingDown());
  }, [permission]);

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
    setOpen(false);
  };

  const handleEnable = async () => {
    const next = await enable();
    if (next === FcmPermissionStateEnum.GRANTED || next === FcmPermissionStateEnum.DENIED) {
      setOpen(false);
      return;
    }
    // Still DEFAULT: the user dismissed the browser's own prompt without
    // choosing. Treat that as "not now" and start the cooldown — otherwise the
    // dialog stays open in front of a prompt they just closed.
    handleDismiss();
  };

  return (
    <ModalLayout
      title="Turn on notifications?"
      maxWidth="xs"
      autoCloseOnConfirm={false}
      externalControl={{ open, onClose: handleDismiss }}
      slotProps={{
        cancel: { text: 'Not now' },
        confirm: { text: 'Enable notifications', onClick: () => handleEnable() },
      }}
    >
      <DialogContentText>
        Get instant updates on your device when something needs your attention. You can change this
        anytime from notification settings.
      </DialogContentText>
    </ModalLayout>
  );
}
