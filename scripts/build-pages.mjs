import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist', 'pages');
if (!output.startsWith(root + sep) || output !== resolve(root, 'dist', 'pages')) {
  throw new Error('Refusing to clean an unexpected output directory.');
}
const versions = Object.fromEntries(await Promise.all(['app.js', 'style.css'].map(async file =>
  [file, createHash('sha256').update((await readFile(resolve(root, file), 'utf8')).replace(/\r\n/g, '\n')).digest('hex').slice(0,12)])));
const html = (await readFile(resolve(root, 'index.html'), 'utf8'))
  .replace('src="app.js"', `src="app.js?v=${versions['app.js']}"`)
  .replace('href="style.css"', `href="style.css?v=${versions['style.css']}"`)
  .replace('</head>', '<meta name="ascend-storage" content="local"></head>')
  .replace('ASCEND: a private, shared questboard for daily tasks, weekly goals and wellness.', 'ASCEND: daily quests, weekly goals, a focus timer and optional wellness check-ins. Progress is saved in your browser.')
  .replaceAll('Shared questboard', 'Personal questboard')
  .replace('Private to the two of you.', 'Progress stays in this browser.')
  .replace('Loading shared progress…', 'Loading your progress…')
  .replace('aria-label="Shared progress"', 'aria-label="Your progress"')
  .replace('Your own daily check-in. Both of you can read the history.', 'Your daily check-in, saved on this device.')
  .replace('ASCEND · Shared progress', 'ASCEND · Personal questboard')
  .replace('<span class="section-note">Shared</span>', '<span class="section-note">This browser</span>')
  .replace('Reset shared data', 'Reset browser data');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, 'index.html'), html),
  ...['style.css', 'app.js', 'state.mjs'].map(async file =>
    writeFile(resolve(output, file), await readFile(resolve(root, file)))),
  writeFile(resolve(output, '.nojekyll'), ''),
]);
console.log('Built the complete ASCEND browser app in dist/pages.');
