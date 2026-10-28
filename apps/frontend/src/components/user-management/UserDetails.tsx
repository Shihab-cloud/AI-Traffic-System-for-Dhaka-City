import { Avatar, Box, Button, Chip, Divider, Paper, Typography, capitalize } from '@mui/material';

import { useSession } from '@/lib/auth-client';
import { UserResponse } from '@/lib/dtos/response/user.res';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RouteUrls } from '@/lib/routes/route.config';
import { generateAvatar } from '@/lib/utils/common.util';
import {
  groupPermissionsByResource,
  permissionActionLabel,
  permissionDescription,
} from '@/lib/utils/permission.util';
import dayjs from 'dayjs';
import NextLink from 'next/link';
import { useMemo } from 'react';
import { Icons, type IconType } from '@/lib/icons';

function InfoItem({
  label,
  value,
  icon: Icon,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: IconType;
}) {
  return (
    <div className="flex items-center gap-4">
      {Icon && <Icon size={24} className="shrink-0 text-gray-500" />}
      <div className="flex min-w-0 flex-col gap-1">
        <Typography variant="body2" component={'div'} color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body1" component={'div'} sx={{ overflowWrap: 'anywhere' }}>
          {value}
        </Typography>
      </div>
    </div>
  );
}

/**
 * What a role lets its holder do, read-only: the granted permissions grouped by area, each with
 * its description — the same shape as the role editor's picker, minus everything not granted.
 */
function RolePermissions({
  permissions,
  isSelf,
}: {
  permissions: PermissionsEnum[];
  isSelf: boolean;
}) {
  const groups = useMemo(() => groupPermissionsByResource(permissions), [permissions]);

  return (
    <Paper variant="outlined" className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <Typography variant="h6">
          {isSelf ? 'What your role can do' : 'What this role can do'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {permissions.length === 0
            ? 'This role grants no permissions.'
            : `${permissions.length} permission${permissions.length === 1 ? '' : 's'} across ${groups.length} area${groups.length === 1 ? '' : 's'}.`}
        </Typography>
      </div>

      {groups.map((group) => (
        <Box
          key={group.resource}
          component="section"
          aria-label={group.label}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
        >
          <Box
            className="flex items-center justify-between gap-2 px-4 py-2"
            sx={{ bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}
          >
            <Typography
              variant="caption"
              sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              {group.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {group.permissions.length}
            </Typography>
          </Box>

          <ul className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {group.permissions.map((permission) => (
              <li key={permission} className="flex gap-2">
                <Box component="span" sx={{ color: 'success.main', mt: '2px', flexShrink: 0 }}>
                  <Icons.check size={18} aria-hidden />
                </Box>
                <div className="flex min-w-0 flex-col">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {permissionActionLabel(permission)}
                  </Typography>
                  {permissionDescription(permission) && (
                    <Typography variant="caption" color="text.secondary">
                      {permissionDescription(permission)}
                    </Typography>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Box>
      ))}
    </Paper>
  );
}

interface UserDetailsProps {
  data: UserResponse;
}

export default function UserDetails({ data }: UserDetailsProps) {
  const { data: sessionData } = useSession();
  const isSelf = sessionData?.user?.id === data.id;

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <Paper
        variant="outlined"
        className="flex w-full flex-col items-center gap-4 p-6 md:flex-row md:items-start"
      >
        <Avatar
          src={data.image || generateAvatar(data.name)}
          alt={data.name}
          sx={{ width: 100, height: 100 }}
        />

        <div className="flex flex-col justify-center gap-2">
          <Typography
            variant="h5"
            sx={{
              fontWeight: 600,
            }}
          >
            {data.name}
          </Typography>
          <div className="flex gap-2">
            <Chip label={capitalize(data.role.name)} size="small" />
            <Chip label={data.status} size="small" color="success" />
          </div>
        </div>

        {isSelf && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row md:ml-auto">
            <Button
              variant="contained"
              startIcon={<Icons.edit />}
              LinkComponent={NextLink}
              href={RouteUrls.profile.accountSecurity}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Update Profile
            </Button>

            <Button
              variant="outlined"
              color="ghost"
              startIcon={<Icons.key />}
              LinkComponent={NextLink}
              href={RouteUrls.profile.accountSecurity}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Change Password
            </Button>
          </div>
        )}
      </Paper>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <Paper variant="outlined" className="flex flex-col gap-6 p-6">
          <Typography variant="h6">Personal Information</Typography>
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <InfoItem label="First Name" value={data.firstName} icon={Icons.idCard} />

            <InfoItem label="Last Name" value={data.lastName} icon={Icons.info} />

            <InfoItem label="Email" value={data.email} icon={Icons.email} />

            <InfoItem
              label="Username"
              value={data.displayUsername ?? data.username ?? 'Not Set'}
              icon={Icons.username}
            />

            <InfoItem label="Phone" value={data.phone ?? 'Not Provided'} icon={Icons.phone} />
          </section>
        </Paper>

        <Paper variant="outlined" className="flex flex-col gap-4 p-6">
          <Typography variant="h6">{isSelf ? 'Your Role' : 'Role'}</Typography>

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {capitalize(data.role.name)}
              </Typography>
              <Chip label={`Rank ${data.role.rank}`} size="small" variant="outlined" />
            </div>
            <Typography variant="body2" color="text.secondary">
              {data.role.description || 'No description'}
            </Typography>
          </div>

          <Divider />

          <InfoItem label="Account Created" value={dayjs(data.createdAt).format('MMMM DD, YYYY')} />
          <InfoItem label="Last Updated" value={dayjs(data.updatedAt).format('MMMM DD, YYYY')} />
        </Paper>
      </div>

      <RolePermissions permissions={data.role.permissions} isSelf={isSelf} />
    </div>
  );
}
