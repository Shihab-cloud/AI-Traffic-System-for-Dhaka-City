'use client';

import { Alert, AlertTitle, Box, Button, IconButton } from '@mui/material';
import { useEffect, useState } from 'react';

import useMfaAction from '@/hooks/actions/useMfaAction';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import { useSession } from '@/lib/auth-client';
import { MfaFactorStatusEnum } from '@/lib/enums/mfa.enum';
import { RouteUrls } from '@/lib/routes/route.config';
import { useRouter } from 'next/navigation';
import { Icons } from '@/lib/icons';

const DISMISS_KEY_PREFIX = 'mfa_banner_dismissed:';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Dismissible nudge for non-mandatory users without MFA enrolled. Hidden when:
 *  - the user already has at least one active factor
 *  - the user is in the mandatory-enrollment grace path (FE redirect handles them)
 *  - the user dismissed within the last 30 days
 */
export default function MfaEnrollmentBanner() {
  const router = useRouter();
  const { useFactorsQuery } = useMfaAction();
  const { usePublicSettingsQuery } = useSystemSettingsAction();
  const session = useSession();
  const factorsQuery = useFactorsQuery();
  const settingsQuery = usePublicSettingsQuery();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  const userId = session.data?.user?.id;

  useEffect(() => {
    if (!userId) return;
    const raw = localStorage.getItem(DISMISS_KEY_PREFIX + userId);
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
  }, [userId]);

  if (session.isPending || !userId) return null;
  if (factorsQuery.isLoading) return null;
  // Don't flash the banner before flags resolve; hide it entirely when MFA is off instance-wide.
  if (settingsQuery.isLoading || !settingsQuery.data?.mfaEnabled) return null;
  if (dismissed !== false) return null;

  // Mandatory-enrollment users get a forced redirect — banner not appropriate.
  const enrollmentRequired = (session.data?.session as unknown as { enrollment_required?: boolean })
    ?.enrollment_required;
  if (enrollmentRequired) return null;

  const factors = factorsQuery.data ?? [];
  const hasActive = factors.some((f) => f.status === MfaFactorStatusEnum.ACTIVE);
  if (hasActive) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY_PREFIX + userId, String(Date.now()));
    setDismissed(true);
  };

  return (
    <Alert
      severity="info"
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
          <Button
            size="small"
            variant="text"
            color="info"
            onClick={() => router.push(RouteUrls.auth.mfaSetup)}
          >
            Setup Now
          </Button>
          <IconButton onClick={dismiss} aria-label="Dismiss">
            <Icons.close />
          </IconButton>
        </Box>
      }
    >
      <AlertTitle>Strengthen your account with multi-factor authentication.</AlertTitle>
      We strongly recommend setting up MFA to protect your account. You can always set it up later
      from your account settings.
    </Alert>
  );
}
