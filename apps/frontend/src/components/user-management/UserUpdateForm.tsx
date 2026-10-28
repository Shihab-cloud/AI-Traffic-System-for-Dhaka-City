import useRbacAction from '@/hooks/actions/useRbacAction';
import { useSession } from '@/lib/auth-client';
import { UserUpdateRequest } from '@/lib/dtos/request/user-management.req';
import { Gender } from '@/lib/enums/gender.enum';
import { tableQueryBuilder } from '@/lib/utils/queryParamBuilder';
import { Autocomplete, MenuItem, TextField, Tooltip } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { Controller, useFormContext } from 'react-hook-form';

const queryParam = tableQueryBuilder({
  pagination: { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER },
});

/** Field layout only — see `UserCreationForm`. */
export default function UserUpdateForm() {
  const { control, watch } = useFormContext<UserUpdateRequest>();

  const { useRoleListQuery } = useRbacAction();

  const { data: roleData, isFetching: rolesLoading } = useRoleListQuery(queryParam);

  const { data: session } = useSession();
  const callerRank = session?.user?.role?.rank ?? Number.POSITIVE_INFINITY;

  // Filter to roles strictly below the caller (decision #1: equal-rank
  // coexistence is BLOCKED).
  const assignableRoles = useMemo(() => {
    const all = roleData?.data ?? [];
    return [...all].filter((role) => role.rank > callerRank).sort((a, b) => a.rank - b.rank);
  }, [roleData, callerRank]);

  const currentRoleId = watch('roleId');
  const currentRole = useMemo(
    () => roleData?.data.find((r) => r.id === currentRoleId),
    [roleData, currentRoleId],
  );

  // If the user being edited has a role that the caller cannot outrank,
  // we disable the dropdown — the backend would reject the change anyway.
  const cannotChangeRole = !!currentRole && currentRole.rank <= callerRank;

  return (
    <div className="grid w-full grid-cols-6 gap-5 md:grid-cols-12">
      <Controller
        name="firstName"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-6"
            label="First Name"
            variant="outlined"
            fullWidth
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />

      <Controller
        name="lastName"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-6"
            label="Last Name"
            variant="outlined"
            fullWidth
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />

      <Controller
        name="email"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-6"
            label="Email"
            variant="outlined"
            type="email"
            fullWidth
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />

      <Controller
        name="username"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-6"
            label="Username"
            placeholder="optional"
            variant="outlined"
            fullWidth
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />

      <Controller
        name="phone"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-6"
            label="Phone"
            variant="outlined"
            fullWidth
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />

      <Controller
        name="dateOfBirth"
        control={control}
        render={({ field, fieldState }) => (
          <DatePicker
            {...field}
            format="DD/MM/YYYY"
            value={field.value ? dayjs(field.value) : null}
            className="col-span-6"
            label="Date of Birth"
            disableFuture
            onChange={(d) => field.onChange(d?.toISOString())}
            slotProps={{
              textField: {
                variant: 'outlined',
                error: !!fieldState.error,
                helperText: fieldState.error?.message,
              },
            }}
          />
        )}
      />

      <Controller
        name="gender"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-6"
            select
            label="Gender"
            variant="outlined"
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          >
            {Object.values(Gender).map((data) => (
              <MenuItem key={data} value={data}>
                {data}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <Controller
        name="roleId"
        control={control}
        render={({ field, fieldState }) => {
          // When disabled because of rank, fall back to the role list (incl.
          // the locked role itself) so the displayed value renders correctly.
          const optionsForDisplay = cannotChangeRole ? (roleData?.data ?? []) : assignableRoles;

          const autocomplete = (
            <Autocomplete
              {...field}
              className="col-span-6"
              fullWidth
              loading={rolesLoading}
              disabled={cannotChangeRole}
              options={optionsForDisplay}
              getOptionLabel={(option) => option.name}
              getOptionKey={(option) => option.id}
              value={optionsForDisplay.find((s) => s.id === field.value) || null}
              onChange={(_, val) => field.onChange(val?.id)}
              renderOption={(props, option) => {
                const { key, ...rest } = props;
                return (
                  <li
                    key={key as React.Key}
                    {...rest}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span>{option.name}</span>
                    <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: '0.75rem' }}>
                      rank {option.rank}
                    </span>
                  </li>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="outlined"
                  label="Role"
                  placeholder="Select Role"
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />
          );

          if (cannotChangeRole) {
            return (
              <Tooltip
                title="You don't have permission to change this user's role."
                arrow
                placement="top"
              >
                <span className="col-span-6">{autocomplete}</span>
              </Tooltip>
            );
          }

          return autocomplete;
        }}
      />

      <Controller
        name="additionalInfo"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            value={field.value || ''}
            className="col-span-full"
            label="Additional Info"
            variant="outlined"
            fullWidth
            multiline
            rows={4}
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />
    </div>
  );
}
