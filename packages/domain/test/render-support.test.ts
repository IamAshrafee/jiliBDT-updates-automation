import { describe, expect, it } from 'vitest';
import { assessRenderSupport } from '../src/render-support.js';

describe('renderer support assessment', () => {
  it('recommends explicit browser capture only for visual blocking content', () => {
    expect(
      assessRenderSupport([
        { code: 'EMBEDDED_OBJECT_UNSUPPORTED', severity: 'BLOCKING', message: 'chart' },
      ]),
    ).toBe('BROWSER_FALLBACK_RECOMMENDED');
  });

  it('blocks structural problems even when visual fallback is also available', () => {
    expect(
      assessRenderSupport([
        { code: 'IN_CELL_IMAGE_UNSUPPORTED', severity: 'BLOCKING', message: 'image' },
        { code: 'HEADER_MISSING', severity: 'BLOCKING', message: 'header' },
      ]),
    ).toBe('BLOCKED');
  });

  it('distinguishes supported output with ordinary warnings', () => {
    expect(assessRenderSupport([])).toBe('SUPPORTED');
    expect(
      assessRenderSupport([{ code: 'HIDDEN_ROW', severity: 'WARNING', message: 'hidden' }]),
    ).toBe('SUPPORTED_WITH_WARNINGS');
  });
});
