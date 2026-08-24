import { authenticate } from '@google-cloud/local-auth';
import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { GOOGLE_SHEETS_SCOPES, persistOAuthToken } from './auth.js';

async function main(): Promise<void> {
  const config = loadConfig({ cwd: resolve(import.meta.dirname, '../../..') });
  process.stdout.write(
    'Opening the local Google OAuth consent flow for read-only Sheets access.\n',
  );
  const client = await authenticate({
    scopes: GOOGLE_SHEETS_SCOPES,
    keyfilePath: config.google.credentialsPath,
  });
  if (!client.credentials.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke the prior grant and run the flow again with offline consent.',
    );
  }
  await persistOAuthToken(config.google.tokenPath, client.credentials);
  process.stdout.write(`OAuth token stored safely at ${config.google.tokenPath}.\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown OAuth error.';
  process.stderr.write(`Google OAuth setup failed: ${message}\n`);
  process.exitCode = 1;
});
