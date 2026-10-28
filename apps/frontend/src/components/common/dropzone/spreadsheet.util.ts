/**
 * Pure helpers behind `SpreadsheetPreview` — cell formatting, column labels and
 * the fill/contrast colour maths.
 *
 * Extracted so the fiddly parts (Office theme tints, `AARRGGBB` alpha
 * reordering, malformed-colour rejection) are unit-testable without mounting a
 * component and driving a `FileReader`. The row-derivation logic deliberately
 * stays in the component: it is bound to the workbook/active-sheet state rather
 * than being a pure transform.
 */

export const MAX_PREVIEW_ROWS = 5;
export const MAX_PREVIEW_COLS = 6;
/**
 * Ceiling on rows kept in state, and so on what expanding can reveal. Deliberately far below
 * a real export's row count: a source spreadsheet can run to tens of thousands of rows, and
 * this is a glance-check before upload, not a viewer.
 */
export const MAX_STORED_ROWS = 200;
/** Height of the expanded scroll box, px. Roughly eleven rows visible at this row height. */
export const EXPANDED_MAX_HEIGHT = 320;

/** One rendered cell: the display text plus the file's own fill, when it carries one. */
export interface PreviewCell {
  v: string;
  /** `#RRGGBB` from the cell's fill. Undefined for unfilled cells, which take the theme ground. */
  bg?: string;
}

export function formatCell(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '');
}

/** `0 → A`, `25 → Z`, `26 → AA` — the spreadsheet column letters the frame is labelled with. */
export function colLetter(index: number): string {
  let label = '';
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) {
    label = String.fromCharCode(65 + (i % 26)) + label;
  }
  return label;
}

/**
 * The default Office theme palette, indexed the way cell styles reference it. Real workbooks
 * mostly carry literal RGB fills; theme-indexed fills resolve against this standard palette as
 * an approximation rather than parsing the file's theme XML.
 */
const OFFICE_THEME_RGB = [
  'FFFFFF', // lt1
  '000000', // dk1
  'E7E6E6', // lt2
  '44546A', // dk2
  '4472C4', // accent1
  'ED7D31', // accent2
  'A5A5A5', // accent3
  'FFC000', // accent4
  '5B9BD5', // accent5
  '70AD47', // accent6
];

/** Applies an Office tint to one channel: positive tints toward white, negative toward black. */
function tintChannel(channel: number, tint: number): number {
  const tinted = tint > 0 ? channel * (1 - tint) + 255 * tint : channel * (1 + tint);
  return Math.round(Math.min(255, Math.max(0, tinted)));
}

/**
 * A cell's fill as `#RRGGBB`, or undefined when it has none.
 *
 * SheetJS (`cellStyles: true`) reports fills as `s.fgColor` with either a literal
 * `rgb` (sometimes alpha-prefixed `AARRGGBB`) or a `theme` index plus `tint`.
 */
export function resolveFill(style: unknown): string | undefined {
  const fg = (style as { fgColor?: { rgb?: string; theme?: number; tint?: number } } | undefined)
    ?.fgColor;
  if (!fg) return undefined;

  /*
   * The file's color is kept exactly as stored — alpha included. The sheet
   * encodes `AARRGGBB`; CSS wants `#RRGGBBAA`, so the alpha byte moves to the
   * end rather than being dropped.
   */
  let hex: string | undefined;
  let alphaHex = '';
  if (fg.rgb) {
    const candidate = fg.rgb.slice(-6);
    // Malformed/non-hex `rgb` strings (e.g. from a corrupt or hand-edited file)
    // must not be trusted as a color — they'd otherwise pass straight through
    // to a CSS `backgroundColor`.
    if (/^[0-9a-fA-F]{6}$/.test(candidate)) {
      hex = candidate;
      if (fg.rgb.length === 8) alphaHex = fg.rgb.slice(0, 2);
    }
  }
  if (!hex && fg.theme !== undefined) hex = OFFICE_THEME_RGB[fg.theme];
  if (!hex) return undefined;

  if (fg.tint) {
    const base = hex;
    hex = [0, 2, 4]
      .map((i) => tintChannel(parseInt(base.slice(i, i + 2), 16), fg.tint!))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('');
  }
  return `#${hex.toUpperCase()}${alphaHex.toUpperCase()}`;
}

/** Readable text on an arbitrary fill: white over dark grounds, near-black over light ones. */
export function contrastText(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? '#FFFFFF' : '#1A1A1A';
}
