'use client';

import * as XLSX from 'xlsx';

import { useEffect, useState } from 'react';

import { Box, IconButton, Stack, Typography } from '@mui/material';

import {
  EXPANDED_MAX_HEIGHT,
  MAX_PREVIEW_COLS,
  MAX_PREVIEW_ROWS,
  MAX_STORED_ROWS,
  type PreviewCell,
  colLetter,
  contrastText,
  formatCell,
  resolveFill,
} from './spreadsheet.util';
import { Icons } from '@/lib/icons';

/** The `+N more` / `Show fewer` toggles — quiet inline buttons that follow the theme's text tones. */
function ExpandToggle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        border: 0,
        p: 0,
        bgcolor: 'transparent',
        cursor: 'pointer',
        font: 'inherit',
        whiteSpace: 'nowrap',
        color: 'text.secondary',
        textDecoration: 'underline dotted',
        textUnderlineOffset: 2,
        '&:hover': { color: 'text.primary' },
      }}
    >
      {label}
    </Box>
  );
}

interface SpreadsheetPreviewProps {
  file: File;
  onRemoveClick: () => void;
}

/**
 * A CSV/Excel file as a Slack-style sheet card: name bar with the green sheet icon, then the
 * grid framed like a real spreadsheet — lettered columns, a numbered row gutter, gridlines on
 * every cell. Row 1 is the file's own header row, shown bold but numbered like any sheet row:
 * the frame supplies the structure, the file supplies the content.
 */
export default function SpreadsheetPreview({ file, onRemoveClick }: SpreadsheetPreviewProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [rows, setRows] = useState<PreviewCell[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedCols, setExpandedCols] = useState(false);
  const [expandedRows, setExpandedRows] = useState(false);

  // Read once per file; sheet switches re-derive rows from the kept workbook without re-reading
  // the bytes. A CSV parses to a single-sheet workbook, so the same path serves both.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before the async FileReader parse; not derivable during render
    setLoading(true);
    setWorkbook(null);
    setActiveSheet(0);

    const reader = new FileReader();
    reader.onload = (e) => {
      // `cellDates: true` returns JS Date objects for date cells instead of
      // raw Excel serial numbers like 46097.000231 — what the user actually
      // wants to see in the preview.
      // `cellStyles` keeps each cell's `.s` so fills the file carries can be painted.
      setWorkbook(
        XLSX.read(e.target?.result, { type: 'array', cellDates: true, cellStyles: true }),
      );
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, [file]);

  useEffect(() => {
    if (!workbook) return;
    const ws = workbook.Sheets[workbook.SheetNames[activeSheet]];
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

    // Fills read off the worksheet by address, aligned with `header: 1`'s physical rows —
    // both start at the sheet range's origin, so `fills[r][c]` belongs to `data[r][c]`.
    const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    const fills: (string | undefined)[][] = range
      ? Array.from({ length: range.e.r - range.s.r + 1 }, (_, r) =>
          Array.from({ length: range.e.c - range.s.c + 1 }, (_, c) => {
            const cell = ws[XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })] as
              { s?: unknown } | undefined;
            return resolveFill(cell?.s);
          }),
        )
      : [];

    // `header: 1` returns every physical row, so `data[0]` is the header and
    // trailing blank padding rows are kept — `data.length` is not a data count.
    const cellRows: PreviewCell[][] = data.map((row, r) =>
      row.map((value, c) => ({ v: formatCell(value), bg: fills[r]?.[c] })),
    );
    const [headerRow, ...dataRows] = cellRows;
    const nonBlankDataRows = dataRows.filter((row) => row.some((cell) => cell.v.trim() !== ''));

    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-derives the visible grid whenever the workbook loads or the active sheet tab changes
    setTotalRows(nonBlankDataRows.length);
    // Kept up to the expansion ceiling, not the collapsed count: the row toggle
    // slices at render time, so there must be something past the first page to
    // reveal. `totalRows` above still counts the whole file.
    setRows([headerRow ?? [], ...nonBlankDataRows.slice(0, MAX_STORED_ROWS)]);
    // A sheet is its own surface: expansion state from the previous sheet would be a lie here.
    setExpandedCols(false);
    setExpandedRows(false);
  }, [workbook, activeSheet]);

  const sheetNames = workbook?.SheetNames ?? [];

  const totalCols = rows.length > 0 ? rows[0].length : 0;
  const hiddenCols = Math.max(0, totalCols - MAX_PREVIEW_COLS);
  const visibleCols = expandedCols
    ? totalCols
    : rows.length > 0
      ? Math.min(totalCols, MAX_PREVIEW_COLS)
      : MAX_PREVIEW_COLS;

  // Row expansion is bounded by what the parse kept, not the file's row count,
  // so `+N more` never offers rows that were never stored.
  const dataRows = rows.slice(1);
  const visibleRows = expandedRows ? dataRows : dataRows.slice(0, MAX_PREVIEW_ROWS);
  const hiddenRows = Math.max(0, dataRows.length - MAX_PREVIEW_ROWS);

  return (
    <Box
      sx={{
        width: '100%',
        overflow: 'hidden',
        borderRadius: 1,
        border: 1,
        borderStyle: 'dashed',
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.secondary',
        }}
      >
        {/* Green sheet icon — the Slack-style tell for "this is a spreadsheet". */}
        <Box component="span" sx={{ display: 'flex', color: 'success.main', flexShrink: 0 }}>
          <Icons.spreadsheet size={18} />
        </Box>
        <Typography
          variant="body2"
          noWrap
          title={file.name}
          sx={{ flex: 1, fontWeight: 500, color: 'text.primary' }}
        >
          {file.name}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
          {(file.size / 1024 / 1024).toFixed(2)} MB
        </Typography>
        <IconButton size="small" color="error" onClick={onRemoveClick} aria-label="Remove file">
          <Icons.remove size={16} />
        </IconButton>
      </Stack>

      {/*
        Vertical scrolling is switched on only while expanded: five rows need no box, and an
        always-on maxHeight would give the collapsed table a scrollbar it never uses.

        Styling lives here as sx selectors so a plain `<table>` (cheap for 200 rows) still draws
        every color from the theme. `borderCollapse: separate` because collapsed borders detach
        from sticky cells while scrolling.
      */}
      <Box
        sx={{
          overflowX: 'auto',
          ...(expandedRows && { overflowY: 'auto', maxHeight: EXPANDED_MAX_HEIGHT }),
          '& table': {
            width: '100%',
            fontSize: (theme) => theme.typography.caption.fontSize,
            borderCollapse: 'separate',
            borderSpacing: 0,
          },
          '& th, & td': {
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            px: 1,
            py: 0.5,
            textAlign: 'left',
            borderRight: 1,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            color: 'text.primary',
          },
          // The frame: column letters and row numbers, quieter ground, centred labels.
          '& th': {
            fontWeight: 500,
            textAlign: 'center',
            color: 'text.secondary',
            bgcolor: 'background.default',
            fontVariantNumeric: 'tabular-nums',
          },
          '& td[data-gutter]': {
            textAlign: 'center',
            color: 'text.disabled',
            bgcolor: 'background.default',
            fontVariantNumeric: 'tabular-nums',
            position: 'sticky',
            left: 0,
            zIndex: 1,
            minWidth: 36,
          },
          // The file's own header row: bold, still numbered as row 1.
          '& tbody tr:first-of-type td:not([data-gutter])': { fontWeight: 600 },
          '& thead th': { position: 'sticky', top: 0, zIndex: 2 },
          '& thead th:first-of-type': { left: 0, zIndex: 3, minWidth: 36 },
        }}
      >
        {loading ? (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', px: 1.5, py: 2, textAlign: 'center' }}
          >
            Loading preview…
          </Typography>
        ) : rows.length === 0 ? (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', px: 1.5, py: 2, textAlign: 'center' }}
          >
            No data to preview
          </Typography>
        ) : (
          <table>
            {/* Sticky letters survive row scrolling; the sticky corner + gutter survive column scrolling. */}
            <thead>
              <tr>
                {/* corner cell above the row-number gutter */}
                <th aria-hidden />
                {Array.from({ length: visibleCols }, (_, i) => (
                  <th key={i}>{colLetter(i)}</th>
                ))}
                {hiddenCols > 0 && (
                  <th>
                    <ExpandToggle
                      label={expandedCols ? 'Show fewer' : `+${hiddenCols} more`}
                      onClick={() => setExpandedCols((v) => !v)}
                    />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {[rows[0], ...visibleRows].map((row, ri) => (
                <tr key={ri}>
                  <td data-gutter="">{ri + 1}</td>
                  {row.slice(0, visibleCols).map((cell, ci) => (
                    <td
                      key={ci}
                      title={cell.v}
                      // The file's own fill wins over the theme ground, with text flipped for
                      // contrast — a colored cell must look colored in dark mode too.
                      style={
                        cell.bg
                          ? { backgroundColor: cell.bg, color: contrastText(cell.bg) }
                          : undefined
                      }
                    >
                      {cell.v}
                    </td>
                  ))}
                  {/* filler under the +N more / Show fewer toggle, so columns stay aligned */}
                  {hiddenCols > 0 && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Box>

      {/*
        Slack-style sheet tabs, only when there is a choice. Below the grid like a real
        workbook's tab strip; switching resets the expansion toggles because each sheet is its
        own surface.
      */}
      {!loading && sheetNames.length > 1 && (
        <Stack
          direction="row"
          sx={{ borderTop: 1, borderColor: 'divider', overflowX: 'auto', flexShrink: 0 }}
        >
          {sheetNames.map((name, index) => {
            const active = index === activeSheet;
            return (
              <Box
                key={name}
                component="button"
                type="button"
                onClick={() => setActiveSheet(index)}
                title={name}
                sx={{
                  border: 0,
                  borderRight: 1,
                  borderColor: 'divider',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: (theme) => theme.typography.caption.fontSize,
                  px: 1.5,
                  py: 0.75,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'text.primary' : 'text.secondary',
                  bgcolor: active ? 'background.paper' : 'background.default',
                  // The active tab carries the sheet's accent, the way a workbook marks its
                  // selected tab.
                  boxShadow: (theme) =>
                    active ? `inset 0 2px 0 ${theme.palette.success.main}` : 'none',
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {name}
              </Box>
            );
          })}
        </Stack>
      )}

      {!loading && totalRows > MAX_PREVIEW_ROWS && (
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.disabled">
            Showing {visibleRows.length} of {totalRows} rows
          </Typography>
          {hiddenRows > 0 && (
            <Typography variant="caption" component="span">
              <ExpandToggle
                label={expandedRows ? 'Show fewer' : `+${hiddenRows} more`}
                onClick={() => setExpandedRows((v) => !v)}
              />
            </Typography>
          )}
          {/* Stated explicitly, or "Showing 200 of 41,905" beside "Show fewer" reads as though
              the remaining rows were one more click away. */}
          {expandedRows && totalRows > MAX_STORED_ROWS && (
            <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto' }}>
              Preview capped at {MAX_STORED_ROWS} rows
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}
