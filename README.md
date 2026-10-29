# ASCEND — Personal Questboard

A small, offline-first daily level-up tracker. Built around a simple idea: **evidence beats motivation**.

## Run it

Open index.html in a modern browser. It uses no paid AI services, dependencies, or build commands.

For consistent local storage behavior, you can also serve this folder using a basic static server (for example, python -m http.server inside the folder), then open the provided localhost URL.

## How to use it

- Pick **up to three measurable quests** per day. One can be for learning, one for building, and one for your body, but choose what matters.
- Mark a quest done **only when there is real evidence**. Each gives 25 XP.
- Set a **weekly boss**—one deliverable you can demonstrate. Defeating it gives 100 XP.
- Use a **15, 25, or 45 minute focus sprint** when you're finding it hard to start. Timer use itself earns no XP.
- Use the **optional wellness check-in** to reflect on mood, sleep, energy, or what might help. There are no sleep targets and no XP tied to how you feel.
- Park tempting side projects in the **idea vault**.
- Export a JSON backup occasionally and import it to restore progress.

No streak penalties or guilt prompts. A missed day is a normal part of life.

## Data and privacy

Everything, including wellness check-ins, lives in your browser's localStorage under the key ascend-questboard-v1. There is no tracking, account, cloud sync, or API key. Clearing browser storage can remove your progress; export a backup first. Wellness check-ins are optional self-reflections, not medical assessments.

## Technical checks

- Run node --check app.js to verify JavaScript syntax.
- Manual acceptance tests to perform in a browser: add three quests, reject a fourth, complete/uncomplete a quest, set and defeat a boss, start/pause/reset the timer, add/remove an idea, record/update a wellness check-in, inspect the 7-day wellness history, export/import, reload, and test a narrow mobile viewport.

This is an original prototype and has not been verified in a live browser session in the current environment.


## Private two-person sync (v2 source)

The browser UI now supports a private shared profile. When hosted with the backend, quests, XP, the idea vault, and optional wellness check-ins are intentionally visible to **both authorized visitors**. The 15/25/45-minute focus timer remains local to each device.

- `server/shared.mjs` implements `GET /api/shared` and `PUT /api/shared` for a Sites Worker, backed by one R2 JSON object.
- The Worker requires a platform-authenticated user and must be deployed behind a **custom private allowlist** limited to the two approved accounts. The API checks same-origin writes and uses conditional ETags to reject conflicting edits.
- `scripts/build-private.mjs` assembles the Worker and static UI into `dist/server/index.js` and `dist/.openai/hosting.json`.
- `node --test server/shared.test.mjs` verifies API behavior; after building, `node --test server/bundle.test.mjs` verifies the private bundle.
- The private hosting project ID is in `.openai/hosting.json`. The binding name is `BUCKET`; no R2 keys are stored in GitHub.
- Existing browser data is **not silently uploaded**: if the remote shared profile is empty, ASCEND asks before importing any saved local data, including wellness.
- On an offline/local-file copy, the UI remains browser-local. A deployed Worker without storage refuses writes rather than pretending to synchronize.

**Security:** Do not enable GitHub Pages for this repository. GitHub Pages is normally public even when this repository is private. The GitHub Actions workflow only checks and packages the source; it intentionally does not publish a public site.

**Status:** This is the committed shared-sync implementation, not proof of a live deployment. Private Sites publication and the second viewer's invitation still require completion; the browser UI remains available locally in the meantime.
