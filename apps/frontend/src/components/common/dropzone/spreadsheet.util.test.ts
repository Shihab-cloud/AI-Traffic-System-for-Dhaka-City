import { describe, expect, it } from 'vitest';

import { colLetter, contrastText, formatCell, resolveFill } from './spreadsheet.util';

describe('colLetter', () => {
  it('maps the single-letter range', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
  });

  it('rolls over into two letters the way a spreadsheet does', () => {
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
    expect(colLetter(51)).toBe('AZ');
    expect(colLetter(52)).toBe('BA');
    expect(colLetter(701)).toBe('ZZ');
    expect(colLetter(702)).toBe('AAA');
  });
});

describe('formatCell', () => {
  it('renders a Date as an ISO calendar date, not an Excel serial', () => {
    expect(formatCell(new Date('2026-09-06T11:22:33Z'))).toBe('2026-09-06');
  });

  it('stringifies primitives and empties nullish', () => {
    expect(formatCell('abc')).toBe('abc');
    expect(formatCell(0)).toBe('0');
    expect(formatCell(false)).toBe('false');
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });
});

describe('resolveFill', () => {
  it('returns undefined when the cell carries no fill', () => {
    expect(resolveFill(undefined)).toBeUndefined();
    expect(resolveFill({})).toBeUndefined();
    expect(resolveFill({ fgColor: {} })).toBeUndefined();
  });

  it('reads a literal six-digit rgb', () => {
    expect(resolveFill({ fgColor: { rgb: 'ff0000' } })).toBe('#FF0000');
  });

  it('moves an AARRGGBB alpha byte to the CSS #RRGGBBAA position', () => {
    expect(resolveFill({ fgColor: { rgb: '80FF0000' } })).toBe('#FF000080');
  });

  it('resolves a theme index against the standard Office palette', () => {
    expect(resolveFill({ fgColor: { theme: 4 } })).toBe('#4472C4');
  });

  it('applies a positive tint toward white and a negative tint toward black', () => {
    expect(resolveFill({ fgColor: { rgb: '000000', tint: 1 } })).toBe('#FFFFFF');
    expect(resolveFill({ fgColor: { rgb: 'FFFFFF', tint: -1 } })).toBe('#000000');
  });

  it('rejects a malformed rgb rather than trusting it as a color', () => {
    expect(resolveFill({ fgColor: { rgb: 'red;xx' } })).toBeUndefined();
  });

  it('rejects a malformed AARRGGBB alpha-prefixed rgb', () => {
    expect(resolveFill({ fgColor: { rgb: '80zzzzzz' } })).toBeUndefined();
  });
});

describe('contrastText', () => {
  it('puts white over a dark fill and near-black over a light one', () => {
    expect(contrastText('#000000')).toBe('#FFFFFF');
    expect(contrastText('#FFFFFF')).toBe('#1A1A1A');
    expect(contrastText('#4472C4')).toBe('#FFFFFF');
    expect(contrastText('#FFC000')).toBe('#1A1A1A');
  });
});
