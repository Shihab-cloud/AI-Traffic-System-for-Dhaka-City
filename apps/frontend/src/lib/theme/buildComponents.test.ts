import { describe, expect, it } from 'vitest';

import {
  buildComponents,
  type ComponentColors,
  type ComponentDensity,
  type ComponentShape,
} from './buildComponents';

const colors: ComponentColors = {
  primary: '#312c68',
  primaryInk: '#FFFFFF',
  secondary: '#403899',
  success: '#384599',
  error: '#e07a7d',
  ghost: '#69687d',
  divider: '#e3e3e8',
  paper: '#FFFFFF',
  textPrimary: '#09090c',
  shadow: { paper: 'paper-shadow', menu: 'menu-shadow' },
};

const shape: ComponentShape = { button: 10, card: 16, input: 10, menuItem: 8, pill: 999 };
const density: ComponentDensity = { inputHeight: 44 };

const components = buildComponents(colors, shape, density, { buttonWeight: 600 });

describe('buildComponents', () => {
  it('leaves the Paper root unstyled so no surface inherits card chrome', () => {
    // Every MUI surface extends Paper. A border/shadow here leaks onto Dialog,
    // Popover, Menu, Drawer, the Autocomplete listbox, Snackbar and Accordion.
    expect(components.MuiPaper?.styleOverrides).toBeUndefined();
    expect(components.MuiPaper?.defaultProps).toEqual({ elevation: 0 });
  });

  it('opts each surface into its own shadow', () => {
    expect((components.MuiCard?.styleOverrides?.root as { boxShadow: string }).boxShadow).toBe(
      'paper-shadow',
    );
    expect((components.MuiDialog?.styleOverrides?.paper as { boxShadow: string }).boxShadow).toBe(
      'menu-shadow',
    );
    expect((components.MuiPopover?.styleOverrides?.paper as { boxShadow: string }).boxShadow).toBe(
      'menu-shadow',
    );
    expect((components.MuiMenu?.styleOverrides?.paper as { boxShadow: string }).boxShadow).toBe(
      'menu-shadow',
    );
    const autocompletePaper = components.MuiAutocomplete?.styleOverrides?.paper as Record<
      string,
      unknown
    >;
    expect(autocompletePaper.border).toBe(`1px solid ${colors.divider}`);
    expect(autocompletePaper.boxShadow).toBe('menu-shadow');
  });

  it('gives outlined Cards a border and no shadow', () => {
    const outlined = components.MuiCard?.variants?.find(
      (v) => (v.props as { variant?: string }).variant === 'outlined',
    );
    expect(outlined?.style).toMatchObject({
      border: `1px solid ${colors.divider}`,
      boxShadow: 'none',
    });
  });

  it('restates a disabled background on both input roots', () => {
    for (const key of ['MuiOutlinedInput', 'MuiPickersInputBase'] as const) {
      const root = components[key]?.styleOverrides?.root as Record<string, unknown>;
      expect(root.backgroundColor).toBe(colors.paper);
      expect(root.minHeight).toBe(44);
      // Without this, the `paper` background above outranks MUI's own
      // `Mui-disabled` styling and a disabled field looks enabled.
      expect(root['&.Mui-disabled']).toBeDefined();
    }
  });

  it('tints filled chips through variants, not the deprecated color slots', () => {
    const slots = components.MuiChip?.styleOverrides as Record<string, unknown>;
    expect(slots.colorPrimary).toBeUndefined();
    expect(slots.colorSecondary).toBeUndefined();
    const variantColors = components.MuiChip?.variants?.map(
      (v) => (v.props as { color?: string }).color,
    );
    expect(variantColors).toEqual(['primary', 'secondary', 'success', 'error']);
    expect(
      components.MuiChip?.variants?.every(
        (v) => (v.props as { variant?: string }).variant === 'filled',
      ),
    ).toBe(true);
  });

  it('sets an explicit tooltip ink colour', () => {
    const tooltip = components.MuiTooltip?.styleOverrides?.tooltip as Record<string, unknown>;
    expect(tooltip.backgroundColor).toBe(colors.primary);
    expect(tooltip.color).toBe(colors.primaryInk);
    expect(tooltip.borderRadius).toBe(shape.menuItem);
  });

  it('leaves sizing to MUI, so the size prop keeps working', () => {
    // A size or padding set here applies to every size alike: `size="small"` would stop shrinking.
    for (const key of [
      'MuiTextField',
      'MuiSelect',
      'MuiAutocomplete',
      'MuiToggleButtonGroup',
      'MuiPickersTextField',
    ] as const) {
      expect(
        (components[key]?.defaultProps as { size?: string } | undefined)?.size,
      ).toBeUndefined();
    }
    const button = components.MuiButton?.styleOverrides?.root as Record<string, unknown>;
    expect(button.padding).toBeUndefined();
    expect(button.fontSize).toBeUndefined();
  });

  it('shrinks input labels through the InputLabel slot, not through TextField', () => {
    expect(components.MuiInputLabel?.styleOverrides?.shrink).toEqual({ fontWeight: 600 });
    expect(
      (components.MuiTextField?.styleOverrides?.root as Record<string, unknown> | undefined)?.[
        '& .MuiInputLabel-shrink'
      ],
    ).toBeUndefined();
  });

  it('falls back when the optional colour tokens are absent', () => {
    const minimal = buildComponents(
      {
        primary: '#000',
        primaryInk: '#fff',
        secondary: '#111',
        divider: '#222',
        paper: '#fff',
        textPrimary: '#000',
        shadow: { paper: 'p', menu: 'm' },
      },
      shape,
      density,
      { buttonWeight: 600 },
    );
    expect(minimal.MuiChip?.variants).toHaveLength(4);
  });
});
