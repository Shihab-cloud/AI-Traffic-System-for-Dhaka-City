import {
  MRT_ColumnFilterFnsState,
  MRT_ColumnFiltersState,
  MRT_SortingState,
} from 'material-react-table';

import queryString from 'qs';

export interface TableQueryBuilder {
  pagination: { pageIndex: number; pageSize: number };
  sorting?: MRT_SortingState;
  search?: string;
  columnFilters?: MRT_ColumnFiltersState;
  columnFilterFns?: MRT_ColumnFilterFnsState;
}

function getFilter(key: string, value: any, columnFilterFn: string = 'contains') {
  return queryString.stringify({ [key]: { [`$${columnFilterFn}`]: value } }, { allowDots: true });
}

function getSort(id: string, desc: boolean) {
  return queryString.stringify({ [id]: desc ? 'desc' : 'asc' }, { allowDots: true });
}

export function tableQueryBuilder({
  pagination,
  sorting = [],
  search,
  columnFilters = [],
  columnFilterFns = {},
}: TableQueryBuilder): QueryParams {
  const params: QueryParams = {
    limit: pagination.pageSize,
    page: pagination.pageIndex + 1,
    sortBy: sorting.map((sort) => getSort(sort.id, sort.desc)),
    filter: columnFilters.map(({ id, value }) => getFilter(id, value, columnFilterFns[id])),
  };

  if (search) {
    params.search = search;
  }

  return params;
}
