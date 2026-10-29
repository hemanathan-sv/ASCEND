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
- Park tempting side projects in the **idea vault**.
- Export a JSON backup occasionally and import it to restore progress.

No streak penalties or guilt prompts. A missed day is a normal part of life.

## Data and privacy

Everything lives in your browser's localStorage under the key ascend-questboard-v1. There is no tracking, account, cloud sync, or API key. Clearing browser storage can remove your progress; export a backup first.

## Technical checks

- Run node --check app.js to verify JavaScript syntax.
- Manual acceptance tests to perform in a browser: add three quests, reject a fourth, complete/uncomplete a quest, set and defeat a boss, start/pause/reset the timer, add/remove an idea, export/import, reload, and test a narrow mobile viewport.

This is an original prototype and has not been verified in a live browser session in the current environment.
