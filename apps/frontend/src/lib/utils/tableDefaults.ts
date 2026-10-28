import { type MRT_RowData, type MRT_TableOptions } from 'material-react-table';

/**
 * Shared default options for all MaterialReactTable instances.
 * Spread into useMaterialReactTable() to apply the outlined style globally.
 */
export const getDefaultMRTOptions = <TData extends MRT_RowData>(): Partial<
  MRT_TableOptions<TData>
> => ({
  muiTablePaperProps: {
    variant: 'outlined',
    elevation: 0,
    sx: { borderColor: 'divider', backgroundColor: 'background.paper', borderRadius: 1.5 },
  },
  muiTopToolbarProps: { sx: { backgroundColor: 'background.paper' } },
  muiBottomToolbarProps: { sx: { backgroundColor: 'background.paper' } },
  muiTableBodyCellProps: { sx: { borderColor: 'divider', backgroundColor: 'background.paper' } },
  muiTableHeadCellProps: { sx: { borderColor: 'divider', backgroundColor: 'background.paper' } },
});
