import type { sheets_v4 } from 'googleapis';
import type { SheetColor } from '@jilibdt/domain';

export type ThemePalette = Map<string, sheets_v4.Schema$ColorStyle>;

function channel(value: number | null | undefined): number {
  return Math.max(0, Math.min(255, Math.round((value ?? 0) * 255)));
}

function component(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

export function rgbColorToCss(
  color: sheets_v4.Schema$Color | null | undefined,
): string | undefined {
  if (!color) return undefined;
  const red = channel(color.red);
  const green = channel(color.green);
  const blue = channel(color.blue);
  const alpha = color.alpha ?? 1;
  if (alpha < 1) {
    const normalizedAlpha = Math.round(alpha * 1000) / 1000;
    return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
  }
  return `#${component(red)}${component(green)}${component(blue)}`;
}

export function colorStyleToSheetColor(
  style: sheets_v4.Schema$ColorStyle | null | undefined,
  fallback: sheets_v4.Schema$Color | null | undefined,
  theme: ThemePalette,
): SheetColor | undefined {
  const direct = rgbColorToCss(style?.rgbColor);
  if (direct) return { css: direct, source: 'RGB' };
  if (style?.themeColor) {
    const themedStyle = theme.get(style.themeColor);
    const themed = rgbColorToCss(themedStyle?.rgbColor);
    if (themed) return { css: themed, source: 'THEME' };
  }
  const fallbackCss = rgbColorToCss(fallback);
  return fallbackCss ? { css: fallbackCss, source: 'RGB' } : undefined;
}

export function buildThemePalette(
  theme: sheets_v4.Schema$SpreadsheetTheme | null | undefined,
): ThemePalette {
  const result: ThemePalette = new Map();
  for (const pair of theme?.themeColors ?? []) {
    if (pair.colorType && pair.color) result.set(pair.colorType, pair.color);
  }
  return result;
}
