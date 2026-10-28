import {
  Alert,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Controller, useFormContext } from 'react-hook-form';

import useRbacAction from '@/hooks/actions/useRbacAction';
import { useSession } from '@/lib/auth-client';
import { UserCreateRequest } from '@/lib/dtos/request/user-management.req';
import { Gender } from '@/lib/enums/gender.enum';
import { tableQueryBuilder } from '@/lib/utils/queryParamBuilder';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import PasswordField from '../common/input/PasswordField';

const queryParam = tableQueryBuilder({
  pagination: { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER },
});

/**
 * Field layout only. The surrounding `ModalLayout`'s Confirm button owns
 * submission — it needs the modal's `closeModal` — so there is no `<form>`
 * here promising an Enter-to-submit that goes nowhere.
 */
export default function UserCreationForm() {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<UserCreateRequest>();

  const sendInvite = watch('sendInvite');

  const { useRoleListQuery } = useRbacAction();

  const { data: roleData, isFetching: rolesLoading } = useRoleListQuery(queryParam);

  const { data: session } = useSession();
  const callerRank = session?.user?.role?.rank ?? Number.POSITIVE_INFINITY;

  // Filter to roles strictly below the caller (decision #1: equal-rank
  // coexistence is BLOCKED). Sorted ascending so the highest-rank assignable
  // option (lowest number) appears first.
  const assignableRoles = useMemo(() => {
    const all = roleData?.data ?? [];
    return [...all].filter((role) => role.rank > callerRank).sort((a, b) => a.rank - b.rank);
  }, [roleData, callerRank]);

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
            helperText={fieldState.error?.message ?? 'Optional if username is provided.'}
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
        render={({ field, fieldState }) => (
          <Autocomplete
            {...field}
            className="col-span-6"
            fullWidth
            loading={rolesLoading}
            options={assignableRoles}
            getOptionLabel={(option) => option.name}
            getOptionKey={(option) => option.id}
            value={assignableRoles.find((s) => s.id === field.value) || null}
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
        )}
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

      <div className="col-span-full flex flex-col gap-2">
        <Typography variant="subtitle2">Account Activation</Typography>
        <Controller
          name="sendInvite"
          control={control}
          render={({ field }) => (
            <ToggleButtonGroup
              exclusive
              value={field.value}
              onChange={(_, val) => {
                if (val !== null) field.onChange(val);
              }}
              fullWidth
            >
              <ToggleButton value={false}>Set Password</ToggleButton>
              <ToggleButton value={true}>Send Invite</ToggleButton>
            </ToggleButtonGroup>
          )}
        />
      </div>

      {sendInvite ? (
        <Alert severity="info" className="col-span-full">
          An invite email will be sent with a link to set their password.
        </Alert>
      ) : (
        <>
          <PasswordField
            className="col-span-full"
            {...register('password')}
            label="Password"
            variant="outlined"
            fullWidth
            error={!!errors.password}
            helperText={errors?.password?.message}
          />

          <PasswordField
            className="col-span-full"
            {...register('confirmPassword')}
            label="Confirm Password"
            variant="outlined"
            fullWidth
            error={!!errors.confirmPassword}
            helperText={errors?.confirmPassword?.message}
          />

          <Controller
            name="sendWelcomeEmail"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                className="col-span-full"
                control={<Checkbox checked={!!field.value} onChange={field.onChange} />}
                label="Send welcome email to user"
              />
            )}
          />
        </>
      )}
    </div>
  );
}
