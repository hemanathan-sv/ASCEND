import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

test('Pages serves the complete app with relative assets and explicit browser storage', async () => {
  execFileSync(process.execPath, ['scripts/build-pages.mjs']);
  const root = new URL('../dist/pages/', import.meta.url);
  assert.deepEqual((await readdir(root)).sort(), ['.nojekyll', 'app.js', 'index.html', 'state.mjs', 'style.css']);
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.ok(html.includes('<meta name="ascend-storage" content="local">'));
  assert.ok(html.includes('type="module" src="app.js"'));
  assert.ok(html.includes('href="style.css"'));
  assert.ok(html.includes('id="quest-form"'));
  assert.ok(html.includes('id="wellness-form"'));
  assert.doesNotMatch(html, /http-equiv="refresh"|chatgpt\.site|ascend-shared-required|@gmail\.com|BUCKET|Both of you|Private to the two/i);
  for(const file of ['app.js', 'style.css', 'state.mjs']) {
    assert.equal(await readFile(new URL(file, root), 'utf8'), await readFile(new URL('../'+file, import.meta.url), 'utf8'));
  }
});

test('workflow uploads only the public Pages artifact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v4\s+with:\s+path: dist\/pages/);
  assert.match(workflow, /uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /npm ci|actions\/upload-artifact@|path: dist\/\s/);
});
