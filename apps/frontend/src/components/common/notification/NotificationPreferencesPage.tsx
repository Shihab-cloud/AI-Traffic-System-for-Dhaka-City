'use client';

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { getTimeZones } from '@vvo/tzdb';
import SettingToggleRow from '@/components/common/settings/SettingToggleRow';
import SettingsSection from '@/components/common/settings/SettingsSection';
import { AppRole } from '@/lib/notification/deep-link';
import { CHANNELS_BY_ROLE, CHANNEL_LABELS } from '@/lib/enum-config/notification-channels-config';
import { NotificationChannelEnum } from '@/lib/enums/notification-channel.enum';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { UpdateGlobalNotificationSettingsRequest } from '@/lib/dtos/request/update-notification-settings.req';
import dayjs, { Dayjs } from 'dayjs';
import toast from 'react-hot-toast';
import { useFcmRegistration } from '@/hooks/useFcmRegistration';
import useNotificationAction from '@/hooks/actions/useNotificationAction';
import { Icons } from '@/lib/icons';

interface Props {
  role: AppRole;
}

/**
 * Shared preferences page (currently one consumer: /notifications/settings).
 *
 * Structure:
 * - Global card — push / in-app / email-fallback + quiet hours + timezone.
 * - Channel table — role-filtered toggle matrix. An override row exists only
 *   when the user has explicitly diverged from the channel default; the
 *   backend persists overrides sparsely.
 */
export default function NotificationPreferencesPage({ role }: Props) {
  const {
    useUserSettingsQuery,
    useUserSettingsChannelsQuery,
    updateUserSettingsMutation,
    unregisterDeviceTokenMutation,
    invalidateSettings,
    invalidateChannelSettings,
  } = useNotificationAction();
  const prefsQuery = useUserSettingsQuery();
  const channelQuery = useUserSettingsChannelsQuery();
  const { permission, enable } = useFcmRegistration();

  const channels = CHANNELS_BY_ROLE[role] ?? [];

  /*
   * Which control is writing. Everything is disabled while any save is open —
   * these patches merge server-side over the settings row as last read, so two in
   * flight can drop one — but only the control that started it shows a spinner.
   */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const [editingQH, setEditingQH] = useState(false);
  const [draftQHStart, setDraftQHStart] = useState<Dayjs | null>(null);
  const [draftQHEnd, setDraftQHEnd] = useState<Dayjs | null>(null);

  const channelPrefs = channelQuery.data ?? {};

  if (prefsQuery.isError) {
    // A dead-end "please refresh the page" makes a full reload the only recovery,
    // which also drops any other unsaved state on the screen. `refetch` is right
    // here — offer it.
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => prefsQuery.refetch()}>
            Retry
          </Button>
        }
      >
        Failed to load notification settings.
      </Alert>
    );
  }

  if (prefsQuery.isLoading || !prefsQuery.data) {
    return (
      <div className="flex items-center justify-center py-16">
        <CircularProgress />
      </div>
    );
  }

  const prefs = prefsQuery.data;

  const saving = updateUserSettingsMutation.isPending;

  const saveGlobal = (
    patch: UpdateGlobalNotificationSettingsRequest,
    successMsg?: string,
    key?: string,
  ) => {
    setPendingKey(key ?? Object.keys(patch)[0] ?? null);
    updateUserSettingsMutation.mutate(patch, {
      onSuccess: () => {
        invalidateSettings();
        if (successMsg) toast.success(successMsg);
      },
      onSettled: () => setPendingKey(null),
    });
  };

  const handlePushToggle = async (next: boolean) => {
    if (next && permission !== 'granted') {
      const result = await enable();
      if (result !== 'granted') {
        toast.error(
          result === 'denied'
            ? 'Browser blocked notifications. Enable them in site settings.'
            : 'Push notifications are not supported in this browser.',
        );
        return;
      }
    }

    // Turning push off must also drop this device's FCM token, or the token
    // table still lists it as a valid delivery target.
    if (!next) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('fcm-token') : null;
      if (token) {
        unregisterDeviceTokenMutation.mutate(token);
        localStorage.removeItem('fcm-token');
      }
    }

    saveGlobal({ pushEnabled: next });
  };

  const toggleChannel = (channel: NotificationChannelEnum, next: boolean) => {
    setPendingKey(channel);
    updateUserSettingsMutation.mutate(
      { preferences: { [channel]: next } },
      {
        onSuccess: () => invalidateChannelSettings(),
        onSettled: () => setPendingKey(null),
      },
    );
  };

  return (
    // Capped: a toggle row stretched wide puts its switch so far from its label
    // that the pair stops reading as one control. Matches the app settings screen.
    <Stack sx={{ gap: 3, maxWidth: 760 }}>
      <SettingsSection
        title="Global settings"
        description="How and when this account receives notifications, across every channel."
      >
        <SettingToggleRow
          title="Push notifications"
          description={
            permission === 'denied'
              ? 'Blocked by your browser. Enable notifications in site settings to turn this on.'
              : 'Receive notifications on this device.'
          }
          disabled={saving || permission === 'denied' || permission === 'unsupported'}
          pending={pendingKey === 'pushEnabled'}
          checked={prefs.pushEnabled && permission === 'granted'}
          onChange={handlePushToggle}
        />
        <SettingToggleRow
          title="Email fallback"
          description="When a critical notification can't be delivered elsewhere, send it to your email."
          checked={prefs.emailFallbackEnabled}
          disabled={saving}
          pending={pendingKey === 'emailFallbackEnabled'}
          onChange={(next) => saveGlobal({ emailFallbackEnabled: next })}
        />
        <SettingToggleRow
          title="Critical bypass quiet hours"
          description="Allow CRITICAL notifications through even during quiet hours."
          checked={prefs.criticalBypassQuietHours}
          disabled={saving}
          pending={pendingKey === 'criticalBypassQuietHours'}
          onChange={(next) => saveGlobal({ criticalBypassQuietHours: next })}
        />
        <Box sx={{ px: 3, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography
              sx={{
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Quiet hours
            </Typography>
            {!editingQH && !prefs.quietHoursStart && (
              <Button
                size="small"
                onClick={() => {
                  setDraftQHStart(null);
                  setDraftQHEnd(null);
                  setEditingQH(true);
                }}
                sx={{ textTransform: 'none', fontSize: 12 }}
              >
                + Add
              </Button>
            )}
          </Box>
          <Typography
            sx={{
              fontSize: 12,
              color: 'text.secondary',
            }}
          >
            During these hours, notifications are deferred until your quiet hours end (except
            CRITICAL if the bypass above is on).
          </Typography>

          {!editingQH && !prefs.quietHoursStart && (
            <Typography
              sx={{
                fontSize: 12,
                color: 'text.disabled',
                fontStyle: 'italic',
              }}
            >
              Not configured — notifications are delivered at any time.
            </Typography>
          )}

          {!editingQH && prefs.quietHoursStart && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.5,
                py: 0.75,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: (t) => alpha(t.palette.primary.main, 0.06),
                alignSelf: 'flex-start',
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 500,
                  mr: 0.5,
                }}
              >
                🌙 {prefs.quietHoursStart} – {prefs.quietHoursEnd ?? '—'}
              </Typography>
              <IconButton
                size="small"
                onClick={() => {
                  setDraftQHStart(parseTimeString(prefs.quietHoursStart));
                  setDraftQHEnd(parseTimeString(prefs.quietHoursEnd));
                  setEditingQH(true);
                }}
              >
                <Icons.edit size={14} />
              </IconButton>
              <IconButton
                size="small"
                disabled={saving}
                onClick={() =>
                  saveGlobal(
                    { quietHoursStart: null, quietHoursEnd: null },
                    'Quiet hours cleared',
                    'quietHours',
                  )
                }
              >
                <Icons.close size={14} />
              </IconButton>
            </Box>
          )}

          {editingQH && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{
                gap: 2,
                alignItems: { sm: 'center' },
              }}
            >
              <TimePicker label="Start" value={draftQHStart} onChange={setDraftQHStart} />
              <TimePicker label="End" value={draftQHEnd} onChange={setDraftQHEnd} />
              <Stack direction="row" sx={{ gap: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  disableElevation
                  disabled={saving || !draftQHStart || !draftQHEnd}
                  onClick={() => {
                    saveGlobal(
                      {
                        quietHoursStart: draftQHStart ? draftQHStart.format('HH:mm') : null,
                        quietHoursEnd: draftQHEnd ? draftQHEnd.format('HH:mm') : null,
                      },
                      'Quiet hours updated',
                      'quietHours',
                    );
                    setEditingQH(false);
                  }}
                  sx={{ textTransform: 'none' }}
                >
                  Save
                </Button>
                <Button
                  size="small"
                  onClick={() => setEditingQH(false)}
                  sx={{ textTransform: 'none' }}
                >
                  Cancel
                </Button>
              </Stack>
            </Stack>
          )}

          <TimezoneSelect
            value={prefs.timezone}
            onChange={(tz) => saveGlobal({ timezone: tz }, 'Timezone updated', 'timezone')}
          />
        </Box>
      </SettingsSection>

      {/*
       * No TYPE / ENABLED column header any more: it was a table heading over a
       * single boolean column, and it was the only thing forcing these rows to be
       * hand-rolled instead of `SettingToggleRow`s.
       */}
      <SettingsSection
        title="Push preferences"
        description="Fine-tune which events deliver a push notification. Global toggles above apply first."
      >
        {channels.map((channel) => {
          const label = CHANNEL_LABELS[channel];
          return (
            <SettingToggleRow
              key={channel}
              title={label.title}
              description={label.description}
              checked={channelPrefs[channel] !== false}
              disabled={saving}
              pending={pendingKey === channel}
              onChange={(next) => toggleChannel(channel, next)}
            />
          );
        })}
      </SettingsSection>
    </Stack>
  );
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const options = useMemo(
    () =>
      getTimeZones({ includeUtc: true })
        .sort((a, b) => a.rawOffsetInMinutes - b.rawOffsetInMinutes)
        .map((tz) => ({
          value: tz.name,
          label: `(UTC${tz.rawFormat.split(' ')[0]}) ${tz.name}`,
          sublabel: tz.alternativeName,
        })),
    [],
  );

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  return (
    <Autocomplete
      options={options}
      value={selected}
      getOptionKey={(o) => (typeof o === 'string' ? o : o.value)}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
      isOptionEqualToValue={(o, v) => o.value === v.value}
      onChange={(_, next) => {
        if (next && typeof next !== 'string') onChange(next.value);
      }}
      renderOption={(props, o) => {
        // MUI hands the key inside `props`; React wants it passed directly, not spread.
        const { key, ...rest } = props;
        return (
          <li key={key} {...rest}>
            <Box>
              <Typography sx={{ fontSize: 13 }}>{typeof o === 'string' ? o : o.label}</Typography>
              {typeof o !== 'string' && o.sublabel && (
                <Typography
                  sx={{
                    fontSize: 11,
                    color: 'text.secondary',
                  }}
                >
                  {o.sublabel}
                </Typography>
              )}
            </Box>
          </li>
        );
      }}
      sx={{ maxWidth: 320 }}
      renderInput={(params) => <TextField {...params} label="Timezone" />}
    />
  );
}

function parseTimeString(value: string | null): Dayjs | null {
  if (!value) return null;
  return dayjs(`1970-01-01T${value}:00`);
}
