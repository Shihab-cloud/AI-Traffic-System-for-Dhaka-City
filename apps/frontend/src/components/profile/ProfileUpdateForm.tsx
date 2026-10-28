import {
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  capitalize,
} from '@mui/material';

import { DatePicker } from '@mui/x-date-pickers';
import { Gender } from '@/lib/enums/gender.enum';
import { ProfileUpdateRequest } from '@/lib/dtos/request/user.req';
import { ProfileUpdateValidation } from '@/lib/validators/user.validator';
import SectionHeader from '../settings/SectionHeader';
import { UserResponse } from '@/lib/dtos/response/user.res';
import dayjs from 'dayjs';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

interface ProfileUpdateFormProps {
  data: UserResponse;
  onSubmit: (data: ProfileUpdateRequest) => void;
}

export default function ProfileUpdateForm({ data, onSubmit }: ProfileUpdateFormProps) {
  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ProfileUpdateRequest>({
    resolver: zodResolver(ProfileUpdateValidation),
    defaultValues: data,
  });

  const dateOfBirth = useWatch({ control, name: 'dateOfBirth' });
  const gender = useWatch({ control, name: 'gender' });

  return (
    <form className="grid grid-cols-6 gap-5 lg:grid-cols-12" onSubmit={handleSubmit(onSubmit)}>
      <SectionHeader
        className="col-span-full"
        title="Profile Information"
        subtitle="Update your profile information to keep your account up-to-date."
      />

      <TextField
        {...register('firstName')}
        className="col-span-6"
        label="First Name"
        variant="outlined"
        error={!!errors.firstName}
        helperText={errors.firstName?.message}
      />

      <TextField
        {...register('lastName')}
        className="col-span-6"
        label="Last Name"
        variant="outlined"
        error={!!errors.lastName}
        helperText={errors.lastName?.message}
      />

      <TextField
        {...register('email')}
        className="col-span-full"
        label="Email"
        variant="outlined"
        error={!!errors.email}
        helperText={errors.email?.message}
      />

      <TextField
        {...register('phone')}
        className="col-span-6"
        label="Phone"
        variant="outlined"
        error={!!errors.phone}
        helperText={errors?.phone?.message}
      />

      <DatePicker
        className="col-span-6"
        label="Date of Birth"
        format="DD/MM/YYYY"
        disableFuture
        // `dayjs(undefined)` is now — an unset date would read as born today.
        value={dateOfBirth ? dayjs(dateOfBirth) : null}
        onChange={(d) => {
          setValue('dateOfBirth', d?.startOf('day').toISOString());
        }}
        slotProps={{
          textField: {
            variant: 'outlined',
            error: !!errors.dateOfBirth,
            helperText: errors?.dateOfBirth?.message,
          },
        }}
      />

      <FormControl className="col-span-full" error={!!errors?.gender}>
        <FormLabel>Gender</FormLabel>
        <RadioGroup
          row
          value={gender || Gender.UNKNOWN}
          onChange={(e) => setValue('gender', e.target.value as Gender)}
        >
          {Object.keys(Gender).map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio />}
              label={capitalize(option.toLowerCase())}
            />
          ))}
        </RadioGroup>
        <FormHelperText>{errors?.gender?.message}</FormHelperText>
      </FormControl>

      <TextField
        {...register('additionalInfo')}
        className="col-span-full"
        label="Additional Info"
        variant="outlined"
        multiline
        rows={4}
        helperText="Your additional information to help us understand you better."
      />

      <div className="col-span-full flex justify-end gap-3">
        <Button variant="outlined" color="ghost" onClick={() => reset(data)}>
          Cancel
        </Button>
        <Button type="submit" variant="contained">
          Update
        </Button>
      </div>
    </form>
  );
}
