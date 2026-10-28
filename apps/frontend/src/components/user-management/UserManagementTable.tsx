'use client';

import { ModalHookLayout } from '@/components/common/modal/ModalLayout';
import useUserManagementAction from '@/hooks/actions/useUserManagementAction';
import useTableQueryParams from '@/hooks/useTableQueryParams';
import { UserResponse } from '@/lib/dtos/response/user.res';
import { UserStatusEnum } from '@/lib/enums/status.enum';
import { RouteUrls } from '@/lib/routes/route.config';
import { generateAvatar } from '@/lib/utils/common.util';
import { tableQueryBuilder } from '@/lib/utils/queryParamBuilder';
import { getDefaultMRTOptions } from '@/lib/utils/tableDefaults';
import { useModal } from '@ebay/nice-modal-react';
import { Avatar, capitalize, Chip, Typography } from '@mui/material';
import dayjs from 'dayjs';
import {
  MaterialReactTable,
  MRT_ActionMenuItem,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from 'material-react-table';
import { useRouter } from 'next/navigation';
import { Icons } from '@/lib/icons';

const columns: MRT_ColumnDef<UserResponse>[] = [
  {
    accessorKey: 'profileImage',
    header: '',
    enableSorting: false,
    enableColumnFilter: false,
    size: 100,
    Cell: ({ row }) => (
      <Avatar
        src={row.original.image || generateAvatar(row.original.name)}
        alt={row.original.name}
      />
    ),
  },
  {
    accessorKey: 'firstName',
    header: 'First Name',
  },
  {
    accessorKey: 'lastName',
    header: 'Last Name',
  },
  {
    accessorKey: 'email',
    header: 'Email',
  },
  {
    accessorKey: 'displayUsername',
    header: 'Username',
    Cell: ({ row }) => row.original.displayUsername ?? row.original.username ?? '—',
  },
  {
    accessorKey: 'phone',
    header: 'Phone',
  },
  {
    accessorKey: 'role',
    id: 'role.name',
    header: 'Role',
    Cell: ({ row }) => <Chip variant="outlined" label={capitalize(row.original.role.name)} />,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    Cell: ({ row }) => {
      const status = row.original.status;
      const statuses = Array.isArray(status) ? status : status ? [status] : [];
      return statuses.map((data) => (
        <Chip key={data} variant="outlined" label={capitalize(data)} sx={{ m: 0.5 }} />
      ));
    },
  },
  {
    accessorKey: 'mfaEnabled',
    header: 'MFA',
    enableSorting: false,
    size: 110,
    Cell: ({ row }) =>
      row.original.mfaEnabled ? (
        <Chip
          icon={<Icons.mfaOn />}
          variant="outlined"
          color="success"
          size="small"
          label="Enabled"
        />
      ) : (
        <Chip
          icon={<Icons.mfaOff />}
          variant="outlined"
          color="default"
          size="small"
          label="Disabled"
        />
      ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Created At',
    Cell: ({ row }) => dayjs(row.original.createdAt).format('DD MMM YYYY hh:mm A'),
  },
  {
    accessorKey: 'updatedAt',
    header: 'Last Updated',
    Cell: ({ row }) => dayjs(row.original.updatedAt).format('DD MMM YYYY hh:mm A'),
  },
];

interface UserManagementTableProps {
  onRowEdit: (data: UserResponse) => void;
  onRowDelete: (data: UserResponse) => void;
  onRowBan: (data: UserResponse) => void;
  onRowUnban: (data: UserResponse) => void;
  onRevokeSession: (data: UserResponse) => void;
  onResetCredentials: (data: UserResponse) => void;
}

export default function UserManagementTable({
  onRowEdit,
  onRowDelete,
  onRowBan,
  onRowUnban,
  onRevokeSession,
  onResetCredentials,
}: UserManagementTableProps) {
  const modal = useModal(ModalHookLayout);
  const router = useRouter();

  const {
    pagination,
    setPagination,
    search,
    setSearch,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnFilterFns,
    setColumnFilterFns,
  } = useTableQueryParams<UserResponse>({ columns });

  const { useUserListQuery } = useUserManagementAction();

  const { data, isFetching } = useUserListQuery(
    tableQueryBuilder({
      pagination,
      search,
      sorting,
      columnFilters,
      columnFilterFns,
    }),
  );

  const onRowView = (data: UserResponse) => {
    router.push(RouteUrls.system.userManagement.profile(data.id));
  };

  const showDeleteConfirmation = (data: UserResponse) => {
    modal.show({
      title: 'Remove Record',
      maxWidth: 'sm',
      children: <Typography variant="h6">Are you sure you want to remove this record?</Typography>,
      slotProps: {
        confirm: {
          text: 'Confirm',
          color: 'error',
          onClick: () => {
            onRowDelete(data);
            modal.remove();
          },
        },
        cancel: {
          text: 'Cancel',
        },
      },
    });
  };

  const showBanConfirmation = (data: UserResponse) => {
    modal.show({
      title: 'Ban User',
      maxWidth: 'sm',
      children: (
        <Typography variant="h6">
          Are you sure you want to ban {data.name}? They will be signed out immediately.
        </Typography>
      ),
      slotProps: {
        confirm: {
          text: 'Ban User',
          color: 'error',
          onClick: () => {
            onRowBan(data);
            modal.remove();
          },
        },
        cancel: {
          text: 'Cancel',
        },
      },
    });
  };

  const showUnbanConfirmation = (data: UserResponse) => {
    modal.show({
      title: 'Unban User',
      maxWidth: 'sm',
      children: <Typography variant="h6">Are you sure you want to unban {data.name}?</Typography>,
      slotProps: {
        confirm: {
          text: 'Unban User',
          color: 'success',
          onClick: () => {
            onRowUnban(data);
            modal.remove();
          },
        },
        cancel: {
          text: 'Cancel',
        },
      },
    });
  };

  const showResetCredentialsConfirmation = (data: UserResponse) => {
    modal.show({
      title: 'Reset Credentials',
      maxWidth: 'sm',
      children: (
        <Typography variant="h6">
          Generate a new temp password for {data.name}? Their existing password will stop working
          immediately, all active sessions will be revoked, and they&apos;ll be required to set a
          new password on next login. The new password will be shown to you once — be ready to copy
          it.
        </Typography>
      ),
      slotProps: {
        confirm: {
          text: 'Generate Temp Password',
          color: 'warning',
          onClick: () => {
            onResetCredentials(data);
            modal.remove();
          },
        },
        cancel: {
          text: 'Cancel',
        },
      },
    });
  };

  const showRevokeSessionsConfirmation = (data: UserResponse) => {
    modal.show({
      title: 'Revoke Sessions',
      maxWidth: 'sm',
      children: (
        <Typography variant="h6">
          Are you sure you want to revoke all active sessions for this user?
        </Typography>
      ),
      slotProps: {
        confirm: {
          text: 'Revoke',
          color: 'error',
          onClick: () => {
            onRevokeSession(data);
            modal.remove();
          },
        },
        cancel: {
          text: 'Cancel',
        },
      },
    });
  };

  const table = useMaterialReactTable<UserResponse>({
    columns,
    data: data?.data || [],
    rowCount: data?.totalData,
    pageCount: data?.totalPages,
    manualPagination: true,
    enableRowActions: true,
    manualFiltering: true,
    manualSorting: true,
    ...getDefaultMRTOptions<UserResponse>(),
    initialState: {
      columnPinning: { left: ['mrt-row-actions'] },
    },
    displayColumnDefOptions: {
      'mrt-row-actions': {
        header: '',
      },
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    onColumnFiltersChange: setColumnFilters,
    onColumnFilterFnsChange: setColumnFilterFns,
    state: {
      pagination,
      globalFilter: search,
      sorting,
      columnFilters,
      columnFilterFns,
      isLoading: isFetching,
    },
    getRowId: (row) => row?.id?.toString() ?? '',
    renderRowActionMenuItems: ({ closeMenu, row, table }) => [
      <MRT_ActionMenuItem
        key={0}
        label="View"
        icon={<Icons.view />}
        table={table}
        onClick={() => {
          onRowView(row.original);
          closeMenu();
        }}
      />,
      <MRT_ActionMenuItem
        key={1}
        label="Edit"
        icon={<Icons.edit />}
        table={table}
        onClick={() => {
          onRowEdit(row.original);
          closeMenu();
        }}
      />,
      <MRT_ActionMenuItem
        key={2}
        label="Revoke Sessions"
        icon={<Icons.revokeSessions />}
        table={table}
        onClick={() => {
          showRevokeSessionsConfirmation(row.original);
          closeMenu();
        }}
      />,
      <MRT_ActionMenuItem
        key={5}
        label="Reset Credentials"
        icon={<Icons.resetPassword />}
        table={table}
        onClick={() => {
          showResetCredentialsConfirmation(row.original);
          closeMenu();
        }}
      />,
      <MRT_ActionMenuItem
        key={3}
        label="Delete"
        icon={<Icons.delete />}
        table={table}
        onClick={() => {
          showDeleteConfirmation(row.original);
          closeMenu();
        }}
      />,
      row.original.status === UserStatusEnum.BANNED ? (
        <MRT_ActionMenuItem
          key={4}
          label="Unban"
          icon={<Icons.unban />}
          table={table}
          onClick={() => {
            showUnbanConfirmation(row.original);
            closeMenu();
          }}
        />
      ) : (
        <MRT_ActionMenuItem
          key={4}
          label="Ban"
          icon={<Icons.ban />}
          table={table}
          onClick={() => {
            showBanConfirmation(row.original);
            closeMenu();
          }}
        />
      ),
    ],
  });

  return <MaterialReactTable table={table} />;
}
