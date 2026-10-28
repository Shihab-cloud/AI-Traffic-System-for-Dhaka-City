'use client';

import { Alert, AlertTitle, Box, Button, IconButton } from '@mui/material';

import useAuthAction from '@/hooks/actions/useAuthAction';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Icons } from '@/lib/icons';

const DISMISS_KEY_PREFIX = 'email_verification_banner_dismissed:';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Banner prompting email verification for users with unverified emails. Hidden when:
 *  - the user has no email or already verified
 *  - the user dismissed within the last 30 days
 */

interface EmailVerificationBannerProps {
  dismissable?: boolean; // Whether the banner can be dismissed by the user. Defaults to true.
}

export default function EmailVerificationBanner({
  dismissable = true,
}: EmailVerificationBannerProps) {
  const session = useSession();
  const { resendEmailVerificationMutation } = useAuthAction();
  const { usePublicSettingsQuery } = useSystemSettingsAction();
  const settingsQuery = usePublicSettingsQuery();
  const [dismissed, setDismissed] = useState(false);

  const user = session.data?.user;

  const handleResend = () => {
    resendEmailVerificationMutation.mutate(undefined, {
      onSuccess: () => toast.success(`Verification link sent to ${user?.email}.`),
    });
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY_PREFIX + user?.id, String(Date.now()));
    setDismissed(true);
  };

  useEffect(() => {
    if (!user?.id || !dismissable) return;

    const raw = localStorage.getItem(DISMISS_KEY_PREFIX + user.id);

    if (!raw) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs dismissed flag to the async, per-user localStorage TTL once session userId resolves; userId is unavailable at first render so a lazy initializer can't read it
      setDismissed(false);
      return;
    }

    const ts = Number(raw);

    if (Number.isNaN(ts) || Date.now() - ts > DISMISS_TTL_MS) {
      setDismissed(false);
    } else {
      setDismissed(true);
    }
  }, [user]);

  if (session.isPending || !user?.id || !user?.email || user.emailVerified || dismissed)
    return null;
  // Don't flash the banner before flags resolve; hide it when email verification is off instance-wide.
  if (settingsQuery.isLoading || !settingsQuery.data?.emailVerificationEnabled) return null;

  return (
    <Alert
      severity="warning"
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
          <Button
            color="inherit"
            size="small"
            onClick={handleResend}
            disabled={resendEmailVerificationMutation.isPending}
          >
            {resendEmailVerificationMutation.isPending ? 'Sending…' : 'Resend'}
          </Button>
          {dismissable && (
            <IconButton onClick={dismiss} aria-label="Dismiss">
              <Icons.close />
            </IconButton>
          )}
        </Box>
      }
    >
      <AlertTitle>Email not verified</AlertTitle>
      Verify <strong>{user.email}</strong> to enable password recovery. Check your inbox for the
      verification link.
    </Alert>
  );
}
