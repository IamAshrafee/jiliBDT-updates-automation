import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { google, type Auth } from 'googleapis';
import { z } from 'zod';

export const GOOGLE_SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

const oauthClientDetailsSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  redirect_uris: z.array(z.string()).min(1),
});

const credentialsSchema = z
  .object({
    installed: oauthClientDetailsSchema.optional(),
    web: oauthClientDetailsSchema.optional(),
  })
  .refine((value) => value.installed || value.web, 'Expected installed or web OAuth credentials.');

const tokenSchema = z
  .object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
    expiry_date: z.number().optional(),
  })
  .passthrough();

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`OAuth JSON file is invalid: ${path}`);
    throw error;
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function createGoogleOAuthClient(
  credentialsPath: string,
  tokenPath: string,
): Promise<Auth.OAuth2Client> {
  const credentials = credentialsSchema.parse(await readJson(credentialsPath));
  const details = credentials.installed ?? credentials.web!;
  const tokens = tokenSchema.parse(await readJson(tokenPath));
  const client = new google.auth.OAuth2(
    details.client_id,
    details.client_secret,
    details.redirect_uris[0],
  );
  client.setCredentials(tokens);
  let currentTokens = tokens;
  client.on('tokens', (freshTokens) => {
    const definedTokens = Object.fromEntries(
      Object.entries(freshTokens).filter(([, value]) => value !== null && value !== undefined),
    );
    currentTokens = tokenSchema.parse({ ...currentTokens, ...definedTokens });
    void writePrivateJson(tokenPath, currentTokens).catch(() => {
      // The request remains usable; callers get a refresh error on the next startup if persistence failed.
    });
  });
  return client;
}

export async function persistOAuthToken(
  path: string,
  credentials: Auth.Credentials,
): Promise<void> {
  await writePrivateJson(path, credentials);
}
