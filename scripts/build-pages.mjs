import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist', 'pages');
if (!output.startsWith(root + sep) || output !== resolve(root, 'dist', 'pages')) {
  throw new Error('Refusing to clean an unexpected output directory.');
}
const html = await readFile(resolve(root, 'pages', 'index.html'), 'utf8');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, 'index.html'), html),
  writeFile(resolve(output, '404.html'), html),
  writeFile(resolve(output, '.nojekyll'), ''),
]);
console.log('Built public ASCEND entry page in dist/pages.');
