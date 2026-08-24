# Google OAuth Setup

Phase 1 uses OAuth user credentials with the read-only Google Sheets scope. Drive access is not requested because the application already knows the spreadsheet ID and does not need Drive discovery or revision APIs.

## Create the credential file

1. In the existing Google Cloud project, enable Google Sheets API v4.
2. Configure the OAuth consent screen appropriately for the organization/application.
3. Create a **Desktop app** OAuth client.
4. Download its JSON file to the path configured by `GOOGLE_OAUTH_CREDENTIALS_PATH`, normally `./data/credentials.json`.

Do not rename a service-account file and use it here; the expected file contains an `installed` or `web` OAuth client definition.

## Generate the token locally

Configure `.env`, then run:

```powershell
pnpm google:auth
```

The command opens Google's local consent flow and writes the returned token to `GOOGLE_OAUTH_TOKEN_PATH` with restricted file permissions where supported. A refresh token is required. The application merges refreshed access-token fields back into the token file without logging them.

If Google does not return a refresh token, revoke the application's prior grant for this account and run authorization again. Also verify whether the OAuth consent screen is in a testing mode that limits refresh-token lifetime.

## VPS note for later phases

Perform interactive authorization on a trusted local computer, then transfer only the required credential/token files through a secure channel to the configured VPS secret location. Do not place them in the repository, image, logs, artifacts, or chat messages.

## Health behavior

`GET /api/sheet/health` verifies that the spreadsheet is accessible and the configured worksheet title exists. Authentication failures return a safe summary; token contents and client secrets are never returned.
