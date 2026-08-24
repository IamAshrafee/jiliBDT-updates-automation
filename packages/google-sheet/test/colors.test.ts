import { describe, expect, it } from 'vitest';
import { buildThemePalette, colorStyleToSheetColor, rgbColorToCss } from '../src/index.js';

describe('Google color conversion', () => {
  it('converts arbitrary RGB floats to deterministic uppercase CSS hex', () => {
    expect(rgbColorToCss({ red: 18 / 255, green: 171 / 255, blue: 52 / 255 })).toBe('#12AB34');
  });

  it('preserves alpha as rgba', () => {
    expect(rgbColorToCss({ red: 1, green: 0, blue: 0, alpha: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('resolves theme color styles', () => {
    const theme = buildThemePalette({
      themeColors: [{ colorType: 'ACCENT1', color: { rgbColor: { red: 0, green: 1, blue: 1 } } }],
    });
    expect(colorStyleToSheetColor({ themeColor: 'ACCENT1' }, undefined, theme)).toEqual({
      css: '#00FFFF',
      source: 'THEME',
    });
  });
});
