'use client';

import PermissionLayout from '@/components/common/layout/PermissionLayout';
import SettingToggleRow from '@/components/common/settings/SettingToggleRow';
import SettingsSection from '@/components/common/settings/SettingsSection';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import { ROUTE_AUDIENCE_PERMISSION } from '@/lib/constants/route-audience.config';
import { UpdateSystemSettingsRequest } from '@/lib/dtos/request/system-settings.req';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import toast from 'react-hot-toast';

/**
 * App-level settings for the workspace admin. Exposes the instance-wide
 * capability toggles backed by the system-settings endpoints.
 */
export default function AppConfigPage() {
  const { useSettingsQuery, useUpdateSettingsMutation } = useSystemSettingsAction();
  const settingsQuery = useSettingsQuery();
  const updateSettings = useUpdateSettingsMutation();

  const settings = settingsQuery.data;

  // Which toggle is writing. All three rows are disabled while any save is open
  // (the PATCH merges over the settings row as last read), but only the row that
  // started it shows a spinner — otherwise the whole card greys out and nothing
  // says which toggle caused it.
  const [pendingField, setPendingField] = useState<keyof UpdateSystemSettingsRequest | null>(null);

  const handleToggle = (field: keyof UpdateSystemSettingsRequest, checked: boolean) => {
    setPendingField(field);
    updateSettings.mutate(
      { [field]: checked },
      {
        onSuccess: () => toast.success('Settings saved.'),
        onSettled: () => setPendingField(null),
      },
    );
  };

  return (
    <PermissionLayout allowedPermissions={[ROUTE_AUDIENCE_PERMISSION[RoleNameEnum.ADMIN]]}>
      {settingsQuery.isError ? (
        // A dead-end "please refresh the page" makes a full reload the only
        // recovery. `refetch` is right here — offer it.
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => settingsQuery.refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load system settings.
        </Alert>
      ) : settingsQuery.isLoading || !settings ? (
        <div className="flex items-center justify-center py-16">
          <CircularProgress />
        </div>
      ) : (
        <Stack sx={{ gap: 3, maxWidth: 760 }}>
          <SettingsSection
            title="Access"
            description="Who can create an account in this workspace."
          >
            <SettingToggleRow
              title="Self-serve sign-up"
              description="Let anyone register their own account from the sign-in screen."
              checked={settings.signupEnabled !== false}
              disabled={updateSettings.isPending}
              pending={updateSettings.isPending && pendingField === 'signupEnabled'}
              onChange={(next) => handleToggle('signupEnabled', next)}
            />
            {settings.signupEnabled === false && (
              <Typography sx={{ px: 3, py: 2, fontSize: 12, color: 'text.secondary' }}>
                Sign-up is closed. New accounts are created from{' '}
                <Box component="span" sx={{ fontWeight: 600 }}>
                  Administration &rarr; Users
                </Box>
                , and the register page offers visitors a way to request access.
              </Typography>
            )}
          </SettingsSection>

          <SettingsSection
            title="Authentication & security"
            description="Instance-wide account security and verification requirements."
          >
            <SettingToggleRow
              title="Multi-factor authentication"
              description="Let users secure their accounts with MFA and show enrollment prompts."
              checked={settings.mfaEnabled}
              disabled={updateSettings.isPending}
              pending={updateSettings.isPending && pendingField === 'mfaEnabled'}
              onChange={(next) => handleToggle('mfaEnabled', next)}
            />
            <SettingToggleRow
              title="Email verification"
              description="Prompt users to verify their email address and show verification banners."
              checked={settings.emailVerificationEnabled}
              disabled={updateSettings.isPending}
              pending={updateSettings.isPending && pendingField === 'emailVerificationEnabled'}
              onChange={(next) => handleToggle('emailVerificationEnabled', next)}
            />
          </SettingsSection>
        </Stack>
      )}
    </PermissionLayout>
  );
}
