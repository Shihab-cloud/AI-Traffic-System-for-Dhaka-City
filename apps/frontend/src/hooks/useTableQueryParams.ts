import {
  MRT_ColumnFilterFnsState,
  MRT_ColumnFiltersState,
  MRT_RowData,
  MRT_SortingState,
  type MRT_ColumnDef,
} from 'material-react-table';
import { useState } from 'react';

interface TableQueryParamsProps<T extends MRT_RowData> {
  columns: MRT_ColumnDef<T>[];
  pageSize?: number;
  defaultColumnFilters?: MRT_ColumnFiltersState;
  defaultSorting?: MRT_SortingState;
  defaultColumnFilterFns?: MRT_ColumnFilterFnsState;
}

export default function useTableQueryParams<T extends MRT_RowData>({
  columns,
  defaultColumnFilters = [],
  defaultSorting = [],
  defaultColumnFilterFns = {},
  pageSize = 10,
}: TableQueryParamsProps<T>) {
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: pageSize,
  });

  const [search, setSearch] = useState('');

  const [sorting, setSorting] = useState<MRT_SortingState>([
    { id: 'createdAt', desc: true },
    ...defaultSorting,
  ]);

  const [columnFilters, setColumnFilters] = useState<MRT_ColumnFiltersState>(defaultColumnFilters);

  //filter modes
  const [columnFilterFns, setColumnFilterFns] = useState<MRT_ColumnFilterFnsState>({
    ...Object.fromEntries(columns.map(({ accessorKey }) => [accessorKey, 'contains'])),
    ...defaultColumnFilterFns,
  });

  return {
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
  };
}
