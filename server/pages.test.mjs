import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

test('Pages artifact contains only the public entry page and fallback', async () => {
  execFileSync(process.execPath, ['scripts/build-pages.mjs']);
  const root = new URL('../dist/pages/', import.meta.url);
  assert.deepEqual((await readdir(root)).sort(), ['.nojekyll', '404.html', 'index.html']);
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.equal(await readFile(new URL('404.html', root), 'utf8'), html);
  const target = 'https://ascend-private-questboard.hemanathansv.chatgpt.site/';
  assert.ok(html.includes(`content="0; url=${target}"`));
  assert.ok(html.includes(`href="${target}" rel="noreferrer">Open ASCEND</a>`));
  assert.doesNotMatch(html, /<script\b|\/api\/|localStorage|sessionStorage|@gmail\.com|BUCKET|schemaVersion/i);
});

test('workflow uploads only the public Pages artifact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v4\s+with:\s+path: dist\/pages/);
  assert.match(workflow, /uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /npm ci|actions\/upload-artifact@|path: dist\/\s/);
});
