# Phase 3 Test and Acceptance Matrix

`PASS` means exercised locally with real SQLite/Playwright or deterministic provider simulation. `NOT TESTED` means real credentials, a safe Telegram destination, or the target VPS was unavailable. Simulated provider tests never claim live-provider acceptance.

| Scenario                              | Result                  | Evidence / notes                                                                 |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| Google OAuth expired                  | PASS (simulated)        | Safe error mapping requests reconnection; real revocation not executed           |
| Google timeout                        | PASS (simulated)        | Workflow moves to attention without sending                                      |
| Sheet unavailable                     | PASS (simulated)        | Safe failure path blocks send; healthy live Sheet also verified                  |
| Sheet structure changed               | PASS                    | Structural fixtures block rendering/sending                                      |
| New caller                            | PASS                    | Discovered as unmapped; no guessed Telegram identity                             |
| Caller renamed                        | PASS                    | New Sheet name remains separate and unmapped                                     |
| Formatting-only change                | PASS (fixture)          | `#BADA55` changes source hash and invalidates approval                           |
| Renderer unsupported object           | PASS                    | Chart/slicer/`IMAGE()` warnings recommend fallback                               |
| Browser fallback                      | NOT TESTED              | Implemented explicit persistent-profile path; Google browser session unavailable |
| Telegram session expired              | PASS (simulated)        | Health blocks sends                                                              |
| Telegram FloodWait                    | PASS (simulated)        | Retry time persisted; no bypass                                                  |
| Telegram permission denied            | PASS (simulated)        | Failed destination remains retryable without resending successes                 |
| Telegram network timeout              | PASS (simulated)        | Ambiguous delivery becomes `UNKNOWN`; no automatic resend                        |
| Telegram ambiguous send               | PASS                    | Startup recovery test converts `SENDING` to `UNKNOWN`                            |
| Double Prepare                        | PASS                    | Partial unique index/idempotent active-run reuse                                 |
| Double approval                       | PASS                    | One final send; second approval rejected                                         |
| Bot + dashboard simultaneous action   | PASS (repository-level) | Transactional approval/delivery claims reject duplicate mutation                 |
| Server restart while waiting          | PASS                    | Due SQLite action resumes; initial reminder not duplicated                       |
| Server crash while sending            | PASS (simulation)       | Startup reconciliation requires manual delivery reconciliation                   |
| Graceful SIGINT shutdown              | PASS                    | Isolated backend logged shutdown and closed through the cleanup path             |
| VPS reboot                            | NOT TESTED              | No target VPS supplied                                                           |
| Disk low                              | PASS (simulation)       | Critical threshold blocks artifact/send paths                                    |
| Database backup                       | PASS                    | SQLite online backup and integrity validation                                    |
| Database restore                      | PASS                    | Temporary restore opens through application database/repository                  |
| Artifact cleanup                      | PASS                    | Only expired terminal run artifacts under the configured root removed            |
| Midnight/date rollover                | PASS                    | Asia/Dhaka rollover tested against UTC server time                               |
| Real Google Sheet slots 1–3           | PASS                    | Existing token valid; 42 callers and three merges rendered for all three slots   |
| Real formatting mutation              | NOT TESTED              | No safe Google test copy/credentials available                                   |
| Real Telegram account/bot/destination | NOT TESTED              | Provider credentials and safe destination unavailable                            |
| Real end-to-end A–F                   | NOT TESTED              | A–F pass with fake transport; not with real providers                            |
| VPS screenshot/reboot                 | NOT TESTED              | No VPS access supplied                                                           |
| Local admin portal                    | PASS                    | Login rendered without browser warnings; authenticated health API verified       |

## Live closeout sequence

1. Install valid Google OAuth credentials and run `pnpm google:auth`, `pnpm sheet:smoke`.
2. Use a copied Sheet/test range for value-only and formatting-only stale-preview tests.
3. Connect Telegram account/bot and Saved Messages/private group.
4. Execute A–F, recording safe message IDs and hashes.
5. Deploy using `vps-deployment.md`, generate/compare a report, and perform a controlled reboot.
6. Only then perform one administrator-confirmed production-group test.
