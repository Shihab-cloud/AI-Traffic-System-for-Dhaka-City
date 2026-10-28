'use client';

import { apiErrorMessage } from '@/lib/utils/common.util';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import BackupCodesPanel from '@/components/auth/BackupCodesPanel';
import EmailOtpEnrollFlow from '@/components/auth/EmailOtpEnrollFlow';
import { ModalHookLayout } from '@/components/common/modal/ModalLayout';
import { MfaEnrollMode, MfaFactorStatusEnum, MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';
import { RouteUrls } from '@/lib/routes/route.config';
import TotpEnrollFlow from '@/components/auth/TotpEnrollFlow';
import { authClient } from '@/lib/auth-client';
import { useModal } from '@ebay/nice-modal-react';
import toast from 'react-hot-toast';
import useMfaAction from '@/hooks/actions/useMfaAction';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import notificationService from '@/lib/services/notification.service';
import { Icons } from '@/lib/icons';

const FACTOR_LABEL: Record<MfaFactorTypeEnum, string> = {
  [MfaFactorTypeEnum.TOTP]: 'Authenticator app (TOTP)',
  [MfaFactorTypeEnum.EMAIL_OTP]: 'Email code',
  [MfaFactorTypeEnum.BACKUP_CODE]: 'Backup code',
};

export default function MfaSettings() {
  const {
    useFactorsQuery,
    useBackupRemainingQuery,
    useTrustedDevicesQuery,
    useDisableMfaMutation,
    useRegenerateBackupCodesMutation,
    useRevokeTrustedDeviceMutation,
  } = useMfaAction();
  const { usePublicSettingsQuery } = useSystemSettingsAction();

  const settingsQuery = usePublicSettingsQuery();
  const factorsQuery = useFactorsQuery();
  const remainingQuery = useBackupRemainingQuery();
  const trustedQuery = useTrustedDevicesQuery();
  const disableMfa = useDisableMfaMutation();
  const regenBackup = useRegenerateBackupCodesMutation();
  const revokeDevice = useRevokeTrustedDeviceMutation();
  const modal = useModal(ModalHookLayout);

  const [enrollMode, setEnrollMode] = useState<MfaEnrollMode>(MfaEnrollMode.CLOSED);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const factors = factorsQuery.data ?? [];
  const activeFactors = factors.filter((f) => f.status === MfaFactorStatusEnum.ACTIVE);
  const hasTotp = activeFactors.some((f) => f.type === MfaFactorTypeEnum.TOTP);
  const hasEmailOtp = activeFactors.some((f) => f.type === MfaFactorTypeEnum.EMAIL_OTP);

  const onEnrollComplete = () => {
    setEnrollMode(MfaEnrollMode.CLOSED);
    factorsQuery.refetch();
    remainingQuery.refetch();
  };

  const handleRegenerate = () => {
    setNewCodes(null);
    regenBackup.mutate(undefined, {
      onSuccess: (data) => setNewCodes(data.codes),
      onError: (err: Error) => toast.error(apiErrorMessage(err, 'Failed to regenerate codes')),
    });
  };

  const runDisable = () => {
    disableMfa.mutate(undefined, {
      onSuccess: async () => {
        toast.success('MFA disabled. Signing out…');
        const token = localStorage.getItem('fcm-token');
        if (token) {
          await notificationService.unregisterDeviceToken(token).catch(() => {});
        }
        localStorage.removeItem('fcm-token');
        await authClient.signOut();
        window.location.href = RouteUrls.auth.signin;
      },
      onError: (err: Error) => toast.error(apiErrorMessage(err, 'Failed to disable MFA')),
    });
  };

  const handleDisable = () => {
    modal.show({
      title: 'Disable MFA',
      maxWidth: 'sm',
      children: (
        <Stack spacing={1}>
          <Typography variant="body1">
            Are you sure you want to disable multi-factor authentication?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            All factors and trusted devices will be removed and you will be signed out immediately.
            You can re-enable MFA later from this page.
          </Typography>
        </Stack>
      ),
      slotProps: {
        confirm: {
          text: 'Disable MFA',
          color: 'error',
          onClick: () => {
            runDisable();
            modal.remove();
          },
        },
        cancel: {
          text: 'Cancel',
        },
      },
    });
  };

  // Hide the whole MFA settings section when MFA is disabled instance-wide.
  if (settingsQuery.isLoading || !settingsQuery.data?.mfaEnabled) return null;

  if (factorsQuery.isLoading) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (enrollMode === MfaEnrollMode.TOTP) {
    return (
      <Stack spacing={2}>
        <TotpEnrollFlow finishLabel="Done" onCompleted={onEnrollComplete} />
        <Button onClick={() => setEnrollMode(MfaEnrollMode.CLOSED)} variant="text">
          Cancel
        </Button>
      </Stack>
    );
  }

  if (enrollMode === MfaEnrollMode.EMAIL_OTP) {
    return (
      <Stack spacing={2}>
        <EmailOtpEnrollFlow finishLabel="Done" onCompleted={onEnrollComplete} />
        <Button onClick={() => setEnrollMode(MfaEnrollMode.CLOSED)} variant="text">
          Cancel
        </Button>
      </Stack>
    );
  }

  if (enrollMode === MfaEnrollMode.PICK) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Add another factor</Typography>
          <Typography variant="body2" color="text.secondary">
            Choose a factor type to enable.
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              flexWrap: 'wrap',
            }}
          >
            <Button
              variant="contained"
              disabled={hasTotp}
              onClick={() => setEnrollMode(MfaEnrollMode.TOTP)}
            >
              {hasTotp ? 'TOTP already enrolled' : 'Set up TOTP'}
            </Button>
            <Button
              variant="contained"
              disabled={hasEmailOtp}
              onClick={() => setEnrollMode(MfaEnrollMode.EMAIL_OTP)}
            >
              {hasEmailOtp ? 'Email OTP already enabled' : 'Enable Email OTP'}
            </Button>
          </Stack>
          <Button onClick={() => setEnrollMode(MfaEnrollMode.CLOSED)} variant="text">
            Cancel
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Multi-factor authentication</Typography>

          {activeFactors.length === 0 ? (
            <>
              <Alert severity="info">
                MFA is not enabled. Add an authenticator app to protect your account.
              </Alert>
              <Button variant="contained" onClick={() => setEnrollMode(MfaEnrollMode.TOTP)}>
                Set up TOTP
              </Button>
            </>
          ) : (
            <>
              <Stack spacing={1}>
                {activeFactors.map((f) => (
                  <Stack
                    key={f.id}
                    direction="row"
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Stack>
                      <Typography variant="body1">{FACTOR_LABEL[f.type] ?? f.type}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {f.lastUsedAt
                          ? `Last used ${new Date(f.lastUsedAt).toLocaleString()}`
                          : 'Never used'}
                      </Typography>
                    </Stack>
                    <Chip label="Active" color="success" size="small" />
                  </Stack>
                ))}
              </Stack>
              <Divider />
              <Stack direction="row" spacing={1}>
                <Button
                  onClick={() => setEnrollMode(MfaEnrollMode.PICK)}
                  variant="outlined"
                  disabled={hasTotp && hasEmailOtp}
                >
                  {hasTotp && hasEmailOtp ? 'All factors enrolled' : 'Add another factor'}
                </Button>
                <Button onClick={handleDisable} color="error" variant="outlined">
                  Disable MFA
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>

      {activeFactors.length > 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Backup codes</Typography>
            <Typography variant="body2" color="text.secondary">
              {/* Branch on the query state, not on `data`. Testing `data`
                  alone meant a failed request rendered "Loading…" forever, with
                  nothing to tell the user it had failed or let them retry. */}
              {remainingQuery.isError
                ? 'Could not load your remaining backup codes.'
                : remainingQuery.data
                  ? `${remainingQuery.data.remaining} unused codes remaining.`
                  : 'Loading…'}
            </Typography>
            <Button onClick={handleRegenerate} variant="outlined" disabled={regenBackup.isPending}>
              Regenerate codes
            </Button>
            {newCodes && <BackupCodesPanel codes={newCodes} title="Your new backup codes" />}
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Trusted devices</Typography>
          {trustedQuery.isLoading && <CircularProgress size={20} />}
          {!trustedQuery.isLoading && (trustedQuery.data?.length ?? 0) === 0 && (
            <Typography variant="body2" color="text.secondary">
              No trusted devices.
            </Typography>
          )}
          {trustedQuery.data?.map((d) => (
            <Stack
              key={d.id}
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Stack>
                <Typography variant="body2">{d.userAgent ?? 'Unknown device'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Expires {new Date(d.expiresAt).toLocaleDateString()}
                </Typography>
              </Stack>
              <IconButton
                onClick={() =>
                  revokeDevice.mutate(d.id, {
                    onSuccess: () => toast.success('Device removed.'),
                    onError: (err: Error) =>
                      toast.error(apiErrorMessage(err, 'Could not remove that device')),
                  })
                }
                disabled={revokeDevice.isPending}
                size="small"
                aria-label={`Revoke trusted device: ${d.userAgent ?? 'Unknown device'}`}
              >
                <Icons.delete />
              </IconButton>
            </Stack>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
// deployment test for FE
