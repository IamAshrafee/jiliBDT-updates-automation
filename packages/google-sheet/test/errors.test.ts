import { describe, expect, it } from 'vitest';
import { safeGoogleError } from '../src/index.js';

describe('safe Google errors', () => {
  it('turns invalid_grant into an actionable error without token details', () => {
    expect(safeGoogleError({ code: 400, message: 'invalid_grant' })).toBe(
      'Google authentication is invalid or expired. Run pnpm google:auth to reconnect.',
    );
  });

  it('does not expose arbitrary provider response contents', () => {
    expect(safeGoogleError({ code: 403, response: { token: 'secret' } })).toBe(
      'Google denied access to the configured spreadsheet.',
    );
  });
});
