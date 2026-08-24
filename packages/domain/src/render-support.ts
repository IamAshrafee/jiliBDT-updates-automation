import type { SnapshotWarning } from './models.js';

export const RENDER_SUPPORT = [
  'SUPPORTED',
  'SUPPORTED_WITH_WARNINGS',
  'BROWSER_FALLBACK_RECOMMENDED',
  'BLOCKED',
] as const;
export type RenderSupport = (typeof RENDER_SUPPORT)[number];

const browserFallbackCodes = new Set([
  'EMBEDDED_OBJECT_UNSUPPORTED',
  'IN_CELL_IMAGE_UNSUPPORTED',
  'OVER_GRID_IMAGE_UNSUPPORTED',
]);

export function assessRenderSupport(warnings: SnapshotWarning[]): RenderSupport {
  const blocking = warnings.filter(({ severity }) => severity === 'BLOCKING');
  if (blocking.some(({ code }) => !browserFallbackCodes.has(code))) return 'BLOCKED';
  if (blocking.length > 0) return 'BROWSER_FALLBACK_RECOMMENDED';
  return warnings.some(({ severity }) => severity === 'WARNING')
    ? 'SUPPORTED_WITH_WARNINGS'
    : 'SUPPORTED';
}
