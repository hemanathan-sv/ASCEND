# ASCEND — Personal Questboard

A small tracker for daily quests, weekly outcomes, skill XP, ideas and optional wellness check-ins. No streak penalties, sleep targets, analytics, external fonts or wellness XP.

Open [ASCEND on GitHub Pages](https://hemanathan-sv.github.io/ASCEND/). The complete website runs directly on Pages. Quests, XP, weekly goals, ideas, focus timer and optional wellness check-ins work there. Progress is saved in that browser; use JSON export/import to move a backup. This deployment has no account system or automatic cross-device sync.

The separate [private shared app](https://ascend-private-questboard.hemanathansv.chatgpt.site/) continues to hold the invited accounts' existing shared records. Pages does not copy or access those records.

## Shared profile

The private hosted app uses one shared profile for the two invited people. Both see all quests, completed tasks, XP, weekly outcomes, recent wins, ideas and wellness records. Each person edits their own daily wellness check-in; each date can hold both entries and one unattributed legacy record. The focus timer stays local to each browser.

The Worker serves the existing interface and `GET /api/shared` / `PUT /api/shared`. The primary private R2 object, `ascend/shared-state-v1.json`, stores the profile. A separate server-owned identity registry records at most two platform-authenticated subject IDs. Exact pre-write snapshots are kept under the private ascend/recovery/ prefix. The `BUCKET` binding is declared in `.openai/hosting.json`; Sites provisions the storage. No storage credentials belong in GitHub.

Each write must match the version previously read. R2 evaluates conditional writes atomically ([Cloudflare documentation](https://developers.cloudflare.com/r2/reference/consistency/)). A conflict freezes shared editing and offers an unsaved backup and a confirmed “Load latest” action. It never force-overwrites the other person's version. A lost save acknowledgement is recovered only when the remote document matches the submitted snapshot.

Pending shared edits are kept in this tab's sessionStorage until acknowledged, so refresh can recover them. They are not a permanent offline copy: closing the tab or clearing browser data can remove the draft. Export before closing if saving fails. Shared data is not copied into localStorage; that key is reserved for legacy/browser-only mode. Unsaved wellness form fields trigger a navigation warning.

The app checks for remote changes every 15 seconds and when returning to the tab. It waits while a field is being edited or wellness fields are unsaved. Existing browser-local progress, including wellness, is uploaded only after explicit consent and only into an empty shared profile.

## Use it

- Choose up to three measurable quests each day. Add, edit, remove, complete or uncomplete them; each completed quest earns 25 XP.
- Set one weekly win condition; completing it earns 100 XP. Editing a completed objective marks it unfinished.
- Levels use 150 XP. Skill XP and recent wins derive from completed records, so toggling a task cannot double-count rewards.
- Run a 15, 25 or 45 minute focus sprint. Timer use earns no XP.
- Expand the focus room to hide the dashboard while the timer runs. Use Back to dashboard or Escape to return without stopping the session.
- Select an unfinished quest in the focus room and mark it complete there. Open focus works without a quest; the timer never completes tasks automatically.
- Collect four milestones from completed quests and weekly goals. These are derived from saved records, award no bonus XP, and update when a completion is undone.
- Open Review to browse seven-day summaries, inspect each day's quests, and see the weekly goal result. Totals use recorded task dates and update when tasks are reopened or removed.
- Optionally save mood, sleep, energy and a short note; both invited people can read them.
- Export JSON backups. Import and reset require an in-page typed-phrase confirmation that both people's shared profile will be replaced. Invalid backups are rejected without truncating data.

Limits: 500 daily records, 100 weekly outcomes, 500 wellness records, 100 ideas and 150,000 bytes per API write. Data exceeding a limit is rejected and remains available for export; it is not silently trimmed.

## Local verification

Requires Node.js 24. There are no runtime packages to install.

```sh
node --check app.js
node --test server/shared.test.mjs server/client.test.mjs
node --test server/pages.test.mjs
node scripts/build-private.mjs
node --test server/bundle.test.mjs
node scripts/preview.mjs
```

The preview listens only at `http://127.0.0.1:4318`. It uses **simulated identities (127.0.0.1 and localhost represent different people) and in-memory R2**, loses its records when stopped, and is for local QA only. It is not evidence of live authentication or persistent online storage. The adapter is excluded from the deployment bundle.

A static server can still preview the browser-only app. A hosted Worker injects a “shared required” marker, so API errors (including 404) never silently turn the production app into local-only mode. Modern module scripts require HTTP; use a local server instead of opening index.html directly.

## Private hosting

Keep the existing project ID and `r2: "BUCKET"` in `.openai/hosting.json`.

1. Use the supported Sites source workflow from this checkout. Open with `create_source_repository_write_credential` and the installed `site-workflow.mjs` helper; pass credentials through hidden stdin only.
2. Build and test, then package with the same helper. Its archive contains only the Worker and hosting manifest. Never edit protected helpers or bypass execution restrictions.
3. Inspect the Sites policy: `custom`, Hem as owner, no groups or extra editors, and only the intended second viewer. Until the second person's address is supplied, keep the project owner-only.
4. Use the provider's secure email invitation to add the second person as a viewer, not a project editor. Do not put their address in source. Invitation acceptance and a test in that person's account are required to verify two-person access.
5. Deploy the exact saved source version with the audience-appropriate native Sites tool. Do not enable public access to make deployment succeed.
6. Verify anonymous requests and forged identity headers are denied at the production dispatch. Check authenticated save/load and refresh, then verify both accounts see the same record.

## GitHub Pages

The Actions workflow verifies the app, then builds and deploys the static website to GitHub Pages on main. In repository Settings → Pages, the build source is GitHub Actions. Pull requests run verification without publishing.

Run `npm run build:pages` to build the complete frontend in `dist/pages`: `index.html`, `style.css`, `app.js`, `state.mjs` and `.nojekyll`. Relative asset paths support the `/ASCEND/` project URL. The Pages HTML explicitly selects browser storage, makes no sync API request and shows that data stays on this device. There is no redirect. Source HTML remains configured for the separate private Worker build. No server, account details, backups or saved records enter the Pages artifact.

The private Worker and R2 storage continue running on Sites. The separate private build remains `npm run build` and must never be uploaded to Pages. Sites publication uses its supported authenticated workflow; do not store hosting tokens in workflows.

## Security boundary

Sites dispatch owns sign-in and the private allowlist. The Worker additionally rejects requests without platform identity, rejects cross-origin/non-JSON writes, validates an exact shared schema, bounds streamed request bytes, and refuses unavailable or corrupt storage. Responses are private/no-store. User strings render through textContent.

The identity headers are trustworthy **only behind Sites' authenticated dispatch**, which must replace browser-supplied values. These headers are not a standalone authentication system. Never expose this Worker through a direct public workers.dev route, a public Site, or an unprotected proxy. Do not add sign-in bypass tokens to the browser, source, CI or backups.

Wellness records are intentionally shared by the two approved people. There is no analytics or record logging. Session drafts and downloaded backups also contain wellness information; handle them as private data.

The unrelated `game-forge/` project is retained and excluded from the ASCEND Worker.

## Wellness schema v3 and recovery

GET /api/shared returns schemaVersion 3 and the platform-authenticated userId, without email or display name. Wellness dates contain arrays of records with authorId, mood, sleep, energy and note. Regular writes preserve every other author's and unattributed record byte for byte in meaning. The server rejects invented authors, duplicate same-day authors and a third registered identity. The Sites custom allowlist remains the primary access authority; registry entries are created only from trusted dispatch identity, never a submitted author field.

Older saved profiles and v1/v2 backups migrate on read to authorId null. GET does not rewrite the profile. The next successful write retains the exact old document in private R2 recovery storage before committing the new schema. No legacy ownership is inferred. Reset preserves the identity registry. v3 restore accepts only author IDs that have authenticated to this profile; after complete storage loss, both people must sign in before restoring their authored backup. No backup data is silently dropped.

Reset and restore are deliberate exceptions to normal own-record editing: either authorized person can replace the whole shared profile with the exact RESET SHARED PROFILE or REPLACE SHARED PROFILE confirmation and a current ETag. Backups and server recovery copies include sensitive wellness data and must stay private. Recovery copies have no public HTTP route.

Quest/boss editing and destructive confirmations use accessible HTML dialogs with keyboard focus and Escape/cancel handling. Remote polling pauses while a dialog is open, preventing a stale confirmation from silently replacing a newer version. Legacy browser tabs fail closed against schema v3 and must reload; export any pending draft first.
