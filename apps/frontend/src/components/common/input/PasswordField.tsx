import { IconButton, TextField, TextFieldProps } from '@mui/material';
import { forwardRef, useState } from 'react';
import { Icons } from '@/lib/icons';

const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ type: _type = 'password', ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    const handleTogglePassword = () => {
      setShowPassword((prev) => !prev);
    };

    return (
      <TextField
        type={showPassword ? 'text' : 'password'}
        {...props}
        slotProps={{
          ...props.slotProps,
          input: {
            ...props.slotProps?.input,
            endAdornment: (
              <IconButton
                onClick={handleTogglePassword}
                edge="end"
                // An icon alone says nothing to a screen reader; the name is all it has.
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Icons.visible /> : <Icons.hidden />}
              </IconButton>
            ),
          },
        }}
        ref={ref}
      />
    );
  },
);

PasswordField.displayName = 'PasswordField';

export default PasswordField;
