# ASCEND — Personal Questboard

A small tracker for daily quests, weekly outcomes, skill XP, ideas and optional wellness check-ins. No streak penalties, sleep targets, analytics, external fonts or wellness XP.

## Shared profile

The private hosted app uses one shared profile for the two invited people. Both see all quests, completed tasks, XP, weekly outcomes, recent wins, ideas and wellness records. The focus timer stays local to each browser.

The Worker serves the existing interface and `GET /api/shared` / `PUT /api/shared`. One private R2 object, `ascend/shared-state-v1.json`, stores the profile. The `BUCKET` binding is declared in `.openai/hosting.json`; Sites provisions the storage. No storage credentials belong in GitHub.

Each write must match the version previously read. R2 evaluates conditional writes atomically ([Cloudflare documentation](https://developers.cloudflare.com/r2/reference/consistency/)). A conflict freezes shared editing and offers an unsaved backup and a confirmed “Load latest” action. It never force-overwrites the other person's version. A lost save acknowledgement is recovered only when the remote document matches the submitted snapshot.

Pending shared edits are kept in this tab's sessionStorage until acknowledged, so refresh can recover them. They are not a permanent offline copy: closing the tab or clearing browser data can remove the draft. Export before closing if saving fails. Shared data is not copied into localStorage; that key is reserved for legacy/browser-only mode. Unsaved wellness form fields trigger a navigation warning.

The app checks for remote changes every 15 seconds and when returning to the tab. It waits while a field is being edited or wellness fields are unsaved. Existing browser-local progress, including wellness, is uploaded only after explicit consent and only into an empty shared profile.

## Use it

- Choose up to three measurable quests each day. Add, edit, remove, complete or uncomplete them; each completed quest earns 25 XP.
- Set one weekly win condition; completing it earns 100 XP. Editing a completed objective marks it unfinished.
- Levels use 150 XP. Skill XP and recent wins derive from completed records, so toggling a task cannot double-count rewards.
- Run a 15, 25 or 45 minute focus sprint. Timer use earns no XP.
- Optionally save mood, sleep, energy and a short note; both invited people can read them.
- Export JSON backups. Import and reset require explicit confirmation that both people's shared profile will be replaced. Invalid backups are rejected without truncating data.

Limits: 500 daily records, 100 weekly outcomes, 500 wellness records, 100 ideas and 150,000 bytes per API write. Data exceeding a limit is rejected and remains available for export; it is not silently trimmed.

## Local verification

Requires Node.js 24. There are no runtime packages to install.

```sh
node --check app.js
node --test server/shared.test.mjs server/client.test.mjs
node scripts/build-private.mjs
node --test server/bundle.test.mjs
node scripts/preview.mjs
```

The preview listens only at `http://127.0.0.1:4318`. It uses **simulated identity and in-memory R2**, loses its records when stopped, and is for local QA only. It is not evidence of live authentication or persistent online storage. The adapter is excluded from the deployment bundle.

A static server can still preview the browser-only app. A hosted Worker injects a “shared required” marker, so API errors (including 404) never silently turn the production app into local-only mode. Modern module scripts require HTTP; use a local server instead of opening index.html directly.

## Private hosting

Keep the existing project ID and `r2: "BUCKET"` in `.openai/hosting.json`.

1. Use the supported Sites source workflow from this checkout. Open with `create_source_repository_write_credential` and the installed `site-workflow.mjs` helper; pass credentials through hidden stdin only.
2. Build and test, then package with the same helper. Its archive contains only the Worker and hosting manifest. Never edit protected helpers or bypass execution restrictions.
3. Inspect the Sites policy: `custom`, Hem as owner, no groups or extra editors, and only the intended second viewer. Until the second person's address is supplied, keep the project owner-only.
4. Use the provider's secure email invitation to add the second person as a viewer, not a project editor. Do not put their address in source. Invitation acceptance and a test in that person's account are required to verify two-person access.
5. Deploy the exact saved source version with the audience-appropriate native Sites tool. Do not enable public access to make deployment succeed.
6. Verify anonymous requests and forged identity headers are denied at the production dispatch. Check authenticated save/load and refresh, then verify both accounts see the same record.

GitHub remains the private source of truth. The Actions workflow runs on main and pull requests, tests and builds, and **never publishes GitHub Pages**. Keep repository Pages disabled. Sites publication uses the supported authenticated workflow; do not store hosting tokens in workflows.

## Security boundary

Sites dispatch owns sign-in and the private allowlist. The Worker additionally rejects requests without platform identity, rejects cross-origin/non-JSON writes, validates an exact shared schema, bounds streamed request bytes, and refuses unavailable or corrupt storage. Responses are private/no-store. User strings render through textContent.

The identity headers are trustworthy **only behind Sites' authenticated dispatch**, which must replace browser-supplied values. These headers are not a standalone authentication system. Never expose this Worker through a direct public workers.dev route, a public Site, or an unprotected proxy. Do not add sign-in bypass tokens to the browser, source, CI or backups.

Wellness records are intentionally shared by the two approved people. There is no analytics or record logging. Session drafts and downloaded backups also contain wellness information; handle them as private data.

The unrelated `game-forge/` project is retained and excluded from the ASCEND Worker.
