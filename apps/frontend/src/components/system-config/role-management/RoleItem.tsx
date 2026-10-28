'use client';

import { Box, Chip, Collapse, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import { PermissionsConfig } from '@/lib/enum-config/permissions-config';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RoleResponse } from '@/lib/dtos/response/role.res';
import { Icons } from '@/lib/icons';

interface RoleItemProps {
  role: RoleResponse;
  onEdit: (role: RoleResponse) => void;
}

function groupPermissions(permissions: PermissionsEnum[]) {
  const groups: Record<string, PermissionsEnum[]> = {};
  for (const perm of permissions) {
    const domain = perm.split(':').slice(1).join(':') || 'other';
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(perm);
  }
  return groups;
}

export default function RoleItem({ role, onEdit }: RoleItemProps) {
  const [expanded, setExpanded] = useState(false);

  const permissionGroups = useMemo(() => groupPermissions(role.permissions), [role.permissions]);

  return (
    <Paper
      variant="outlined"
      sx={{
        overflow: 'hidden',
        borderLeft: 4,
        borderColor: 'primary.main',
        transition: 'box-shadow 0.2s ease',
        '&:hover': {
          boxShadow: (theme) =>
            theme.palette.mode === 'dark' ? theme.shadows[4] : theme.shadows[1],
        },
      }}
    >
      {/* Card header */}
      <div className="flex items-start gap-3 p-4">
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{
            mt: 0.25,
            bgcolor: expanded ? 'action.selected' : 'action.hover',
            transition: 'all 0.2s ease',
          }}
        >
          {expanded ? <Icons.expand size={18} /> : <Icons.chevronRight size={18} />}
        </IconButton>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Typography
              variant="subtitle1"
              noWrap
              sx={{
                fontWeight: 700,
              }}
            >
              {role.name}
            </Typography>

            <Tooltip title="Lower number = higher in the hierarchy" arrow>
              <Chip
                size="small"
                label={`Rank ${role.rank}`}
                color="secondary"
                variant="outlined"
                sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
              />
            </Tooltip>

            <Chip
              size="small"
              label={`${role.permissions.length} ${role.permissions.length === 1 ? 'permission' : 'permissions'}`}
              variant="outlined"
              sx={{ fontWeight: 500, fontSize: '0.7rem', height: 22 }}
            />

            {role.isDefault && (
              <Chip
                size="small"
                icon={<Icons.verified size={13} />}
                label="Default"
                color="primary"
                variant="filled"
                sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
              />
            )}
          </div>

          <Typography
            variant="body2"
            color={role.description ? 'text.secondary' : 'text.disabled'}
            noWrap
            sx={{
              mt: 0.5,
              fontStyle: role.description ? 'normal' : 'italic',
            }}
          >
            {role.description || 'No description'}
          </Typography>
        </div>

        <Tooltip title="Edit role" arrow>
          <IconButton onClick={() => onEdit(role)}>
            <Icons.edit size={18} />
          </IconButton>
        </Tooltip>
      </div>

      {/* Expanded permissions grouped by category */}
      <Collapse in={expanded}>
        <Box
          sx={{
            mx: 2,
            mb: 2,
            ml: '52px',
            borderRadius: 2,
            bgcolor: 'action.hover',
            border: 1,
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          {role.permissions.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Typography
                variant="body2"
                color="text.disabled"
                sx={{
                  fontStyle: 'italic',
                }}
              >
                No permissions assigned to this role
              </Typography>
            </div>
          ) : (
            <Box sx={{ '& > div + div': { borderTop: 1, borderColor: 'divider' } }}>
              {Object.entries(permissionGroups).map(([domain, perms]) => {
                return (
                  <div key={domain} className="px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          color: 'text.secondary',
                        }}
                      >
                        <Icons.permissions size={14} />
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}
                      >
                        {domain.replace(/_/g, ' ')}
                      </Typography>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {perms.map((perm) => {
                        const action = perm.split(':')[0] || perm;

                        return (
                          <Tooltip
                            key={perm}
                            title={PermissionsConfig[perm]?.description ?? ''}
                            arrow
                            placement="top"
                          >
                            <Chip
                              size="small"
                              label={action}
                              variant="outlined"
                              sx={{
                                fontSize: '0.7rem',
                                height: 24,
                                textTransform: 'capitalize',
                                fontWeight: 500,
                              }}
                            />
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
