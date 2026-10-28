'use client';

import StatusChip from '@/components/common/StatusChip';
import TableActionButton, { tableActionsWidth } from '@/components/common/table/TableActionButton';
import useSupportTicketAction from '@/hooks/actions/useSupportTicketAction';
import useTableQueryParams from '@/hooks/useTableQueryParams';
import { SupportTicketResponse } from '@/lib/dtos/response/support.res';
import { RouteUrls } from '@/lib/routes/route.config';
import { tableQueryBuilder } from '@/lib/utils/queryParamBuilder';
import { getDefaultMRTOptions } from '@/lib/utils/tableDefaults';
import { Typography } from '@mui/material';
import dayjs from 'dayjs';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import { useRouter } from 'next/navigation';
import { Icons } from '@/lib/icons';

const columns: MRT_ColumnDef<SupportTicketResponse>[] = [
  { accessorKey: 'ticketNumber', header: 'Ticket #', size: 140 },
  {
    accessorKey: 'subject',
    header: 'Subject',
    Cell: ({ row }) => (
      <Typography
        variant="body2"
        noWrap
        sx={{
          fontWeight: 600,
          maxWidth: 250,
        }}
      >
        {row.original.subject}
      </Typography>
    ),
  },
  {
    accessorKey: 'category',
    header: 'Category',
    Cell: ({ row }) => <StatusChip status={row.original.category} />,
  },
  {
    accessorKey: 'priority',
    header: 'Priority',
    Cell: ({ row }) => <StatusChip status={row.original.priority} variant="filled" />,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    Cell: ({ row }) => <StatusChip status={row.original.status} />,
  },
  {
    accessorKey: 'submittedByName',
    header: 'Submitted By',
    Cell: ({ row }) => row.original.submittedByName || '-',
  },
  {
    accessorKey: 'lastResponseAt',
    header: 'Last Response',
    Cell: ({ row }) =>
      row.original.lastResponseAt
        ? dayjs(row.original.lastResponseAt).format('MMM D, h:mm A')
        : '-',
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    Cell: ({ row }) => dayjs(row.original.createdAt).format('MMM D, YYYY'),
  },
];

export default function TicketTable() {
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
  } = useTableQueryParams<SupportTicketResponse>({ columns });

  const { useTicketListQuery } = useSupportTicketAction();
  const { data, isFetching } = useTicketListQuery(
    tableQueryBuilder({ pagination, search, sorting, columnFilters, columnFilterFns }),
  );

  const router = useRouter();
  const getDetailUrl = (ticketId: ID) => RouteUrls.admin.support.detail(ticketId);

  const table = useMaterialReactTable<SupportTicketResponse>({
    columns,
    data: data?.data || [],
    rowCount: data?.totalData,
    pageCount: data?.totalPages,
    manualPagination: true,
    enableRowActions: true,
    manualFiltering: true,
    manualSorting: true,
    ...getDefaultMRTOptions<SupportTicketResponse>(),
    initialState: {
      columnPinning: { left: ['mrt-row-actions'] },
    },
    displayColumnDefOptions: {
      'mrt-row-actions': { header: '', size: tableActionsWidth(1) },
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
    getRowId: (row) => row.id,
    // One action, so a button rather than a menu: a menu would cost a second click to reach it.
    renderRowActions: ({ row }) => (
      <TableActionButton
        title="View details"
        icon={<Icons.view />}
        onClick={() => router.push(getDetailUrl(row.original.id))}
      />
    ),
  });

  return <MaterialReactTable table={table} />;
}
