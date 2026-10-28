'use client';

import { Box, Button, Typography } from '@mui/material';

import { PermissionsEnum } from '@/lib/enums/permission.enum';
import useHasPermission from '@/hooks/useHasPermission';
import { useRouter } from 'next/navigation';
import { Icons } from '@/lib/icons';

interface PermissionLayoutProps {
  /**
   * An array of permissions that are allowed to access the children components.
   */
  allowedPermissions: PermissionsEnum[];
  /**
   * If true, the user must have all the allowed permissions to access the children components. If false, the user must have at least one of the allowed permissions.
   */
  requiredAll?: boolean;
  children: React.ReactNode;
}

export default function PermissionLayout({
  allowedPermissions,
  requiredAll = false,
  children,
}: PermissionLayoutProps) {
  const { hasPermission, isPending } = useHasPermission(allowedPermissions, requiredAll);
  const router = useRouter();

  if (isPending) return null;

  if (hasPermission) return <>{children}</>;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 2,
        textAlign: 'center',
        px: 3,
      }}
    >
      <Box
        sx={{
          width: 120,
          height: 120,
          borderRadius: '50%',
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 1,
        }}
      >
        <Box component="span" sx={{ display: 'flex', color: 'text.secondary' }}>
          <Icons.noAccess size={56} />
        </Box>
      </Box>

      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        Access Denied
      </Typography>

      <Typography
        variant="body1"
        sx={{
          color: 'text.secondary',
          maxWidth: 420,
        }}
      >
        You don&apos;t have the required permissions to view this page. Please contact your
        administrator if you believe this is an error.
      </Typography>

      <Button
        variant="outlined"
        startIcon={<Icons.back />}
        onClick={() => router.back()}
        sx={{ mt: 2 }}
      >
        Go Back
      </Button>
    </Box>
  );
}
