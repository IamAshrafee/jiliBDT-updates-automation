import { describe, expect, it } from 'vitest';
import { renderSnapshotHtml } from '../src/index.js';
import { makeSnapshot } from '../../../tests/fixtures/snapshot.js';

describe('format-aware HTML renderer', () => {
  it('copies an unknown source background generically', async () => {
    const { html } = await renderSnapshotHtml(makeSnapshot());
    expect(html).toContain('background:#12AB34');
    expect(html).toContain('background:#00FFFF');
  });

  it('renders source merges, row labels, column labels, and notes', async () => {
    const { html, width } = await renderSnapshotHtml(makeSnapshot());
    expect(html).toContain('colspan="8"');
    expect(html).toContain('rowspan="3"');
    expect(html).toContain('>A</th>');
    expect(html).toContain('>H</th>');
    expect(html).toContain('>7</th>');
    expect(html).toContain('class="data-cell has-note"');
    expect(width).toBe(1265);
  });
});
