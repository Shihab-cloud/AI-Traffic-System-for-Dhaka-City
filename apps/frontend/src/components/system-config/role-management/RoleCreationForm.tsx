import { useSession } from '@/lib/auth-client';
import { RoleCreationRequest } from '@/lib/dtos/request/role.req';
import { ALL_PERMISSIONS, PermissionsEnum } from '@/lib/enums/permission.enum';
import {
  filterPermissionGroups,
  groupPermissionsByResource,
  permissionActionLabel,
  permissionDescription,
} from '@/lib/utils/permission.util';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { ReactNode, useMemo, useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { Icons } from '@/lib/icons';

interface RoleCreationFormProps {
  /**
   * Role id being edited (when in edit mode). Used to detect whether the
   * caller is editing their own role and apply the self-demotion clamp
   * (decision #3 in the role-hierarchy plan). Omit for create mode.
   */
  editingRoleId?: string;
  /**
   * Existing rank of the role being edited. When the caller's own role is
   * being edited, the numeric input is clamped so `newRank <= existingRank`
   * — i.e. the user can only promote themselves, never demote. Backend
   * enforces this server-side; this is UX-only.
   */
  existingRank?: number;
}

const PERMISSION_GROUPS = groupPermissionsByResource(ALL_PERMISSIONS);

/**
 * Field layout only. The surrounding `ModalLayout`'s Confirm button owns
 * submission — it needs the modal's `closeModal` — so there is no `<form>`
 * here promising an Enter-to-submit that goes nowhere.
 */
export default function RoleCreationForm({ editingRoleId, existingRank }: RoleCreationFormProps) {
  const { control } = useFormContext<RoleCreationRequest>();

  const { data: session } = useSession();
  const callerRoleId = session?.user?.role?.id;

  // Self-demotion clamp (plan decision #3): if the caller is editing their
  // own role, they can only promote (lower rank), never demote (higher rank).
  const isEditingOwnRole = !!editingRoleId && !!callerRoleId && editingRoleId === callerRoleId;
  const rankMax = isEditingOwnRole && typeof existingRank === 'number' ? existingRank : undefined;

  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Role details">
        <div className="grid grid-cols-12 gap-4">
          <Controller
            name="name"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                value={field.value || ''}
                className="col-span-12 sm:col-span-8"
                label="Role Name"
                placeholder="e.g. Support Lead"
                variant="outlined"
                fullWidth
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
              />
            )}
          />

          <Controller
            name="rank"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                value={field.value ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    field.onChange('');
                    return;
                  }
                  const parsed = Number(raw);
                  field.onChange(Number.isNaN(parsed) ? raw : parsed);
                }}
                className="col-span-12 sm:col-span-4"
                type="number"
                label="Rank"
                variant="outlined"
                fullWidth
                slotProps={{ htmlInput: { min: 0, max: rankMax, step: 1 } }}
                error={!!fieldState.error}
                helperText={fieldState.error?.message ?? 'Lower number = higher up'}
              />
            )}
          />

          <Controller
            name="description"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                value={field.value || ''}
                className="col-span-12"
                label="Description"
                placeholder="What this role is for and who should hold it"
                variant="outlined"
                fullWidth
                multiline
                rows={3}
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
              />
            )}
          />

          <Typography variant="caption" color="text.secondary" className="col-span-12">
            Rank orders the hierarchy — super admin is 0. Leave gaps (10, 20, 30) so future roles
            can slot in between.
          </Typography>

          {/*
            A real alert rather than the previous Tooltip-wrapped-span around a
            disabled boundary: that was unreachable by keyboard and only appeared
            once the value had already hit the max, i.e. after the user had
            already been stopped without being told why.
          */}
          {isEditingOwnRole && (
            <Alert
              severity="info"
              variant="outlined"
              className="col-span-12"
              sx={{ py: 0, alignItems: 'center' }}
            >
              <Typography variant="caption">
                This is your own role. You can promote it (lower number) but not demote it
                {typeof rankMax === 'number' ? ` past ${rankMax}` : ''}.
              </Typography>
            </Alert>
          )}
        </div>
      </FormSection>

      <Divider />

      <Controller
        name="permissions"
        control={control}
        render={({ field, fieldState }) => (
          <PermissionPicker
            value={field.value ?? []}
            onChange={field.onChange}
            error={!!fieldState.error}
            helperText={fieldState.error?.message}
          />
        )}
      />
    </div>
  );
}

/** Uppercase caption section header with an optional right-aligned action slot. */
function FormSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          {title}
        </Typography>
        {action}
      </div>
      {children}
    </section>
  );
}

interface PermissionPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  error?: boolean;
  helperText?: string;
}

/**
 * One always-visible panel: search, tri-state group rows, permission rows with
 * their descriptions.
 *
 * Replaces a multi-`Select` plus a mirror list of the same selection below it —
 * the same information in two places, where choosing meant opening a dropdown
 * tall enough to cover the form you were filling in.
 */
function PermissionPicker({ value, onChange, error, helperText }: PermissionPickerProps) {
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(value), [value]);
  const visibleGroups = useMemo(() => filterPermissionGroups(PERMISSION_GROUPS, query), [query]);

  const togglePermission = (permission: PermissionsEnum) => {
    onChange(
      selected.has(permission) ? value.filter((v) => v !== permission) : [...value, permission],
    );
  };

  const toggleGroup = (permissions: PermissionsEnum[], allSelected: boolean) => {
    if (allSelected) {
      const removed = new Set<string>(permissions);
      onChange(value.filter((v) => !removed.has(v)));
      return;
    }
    onChange([...new Set([...value, ...permissions])]);
  };

  return (
    <FormSection
      title="Permissions"
      action={
        <div className="flex items-center gap-1">
          <Chip
            size="small"
            label={`${value.length} / ${ALL_PERMISSIONS.length} selected`}
            color={value.length ? 'primary' : 'default'}
            variant="outlined"
            sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
          />
          <Button
            size="small"
            onClick={() => onChange([...ALL_PERMISSIONS])}
            disabled={value.length === ALL_PERMISSIONS.length}
          >
            Select all
          </Button>
          <Button
            size="small"
            color="inherit"
            onClick={() => onChange([])}
            disabled={value.length === 0}
          >
            Clear
          </Button>
        </div>
      }
    >
      <Paper
        variant="outlined"
        sx={{
          overflow: 'hidden',
          borderColor: error ? 'error.main' : 'divider',
        }}
      >
        <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Icons.search size={16} />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setQuery('')} aria-label="Clear search">
                      <Icons.close size={14} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
          />
        </Box>

        <Box
          sx={{
            maxHeight: 280,
            overflow: 'auto',
            '& > div + div': { borderTop: 1, borderColor: 'divider' },
          }}
        >
          {visibleGroups.length === 0 && (
            <div className="px-4 py-8 text-center">
              <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                No permissions match &ldquo;{query}&rdquo;
              </Typography>
            </div>
          )}

          {visibleGroups.map((group) => {
            const selectedCount = group.permissions.filter((p) => selected.has(p)).length;
            const allSelected = selectedCount === group.permissions.length;

            return (
              <div key={group.resource} className="px-2 py-2">
                <FormControlLabel
                  sx={{
                    m: 0,
                    width: '100%',
                    borderRadius: 1,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                  control={
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={selectedCount > 0 && !allSelected}
                      onChange={() => toggleGroup(group.permissions, allSelected)}
                    />
                  }
                  label={
                    <div className="flex items-center gap-1.5">
                      <Box sx={{ display: 'flex', color: 'text.secondary' }}>
                        <Icons.permissions size={13} />
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
                      >
                        {group.label}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {selectedCount}/{group.permissions.length}
                      </Typography>
                    </div>
                  }
                />

                <div className="mt-0.5 flex flex-col pl-6">
                  {group.permissions.map((permission) => {
                    const checked = selected.has(permission);

                    return (
                      <FormControlLabel
                        key={permission}
                        sx={{
                          m: 0,
                          width: '100%',
                          alignItems: 'flex-start',
                          py: 0.5,
                          bgcolor: checked ? 'action.selected' : 'transparent',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                        control={
                          <Checkbox
                            size="small"
                            checked={checked}
                            onChange={() => togglePermission(permission)}
                            sx={{ py: 0.25 }}
                          />
                        }
                        label={
                          <div className="min-w-0">
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {permissionActionLabel(permission)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="p">
                              {permissionDescription(permission)}
                            </Typography>
                          </div>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Box>
      </Paper>

      {helperText && <FormHelperText error={error}>{helperText}</FormHelperText>}
    </FormSection>
  );
}
