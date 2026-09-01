import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDir = join(root, '.humanink');
const outputFile = join(outputDir, 'cordis.patch.yml');
const pluginEntry = join(root, 'packages', 'humanink-harness', 'dist', 'index.js')
  .replaceAll('\\', '/');

const patch = `- insert:\n    - id: dsh-humanink\n      name: '${pluginEntry}'\n      config:\n        dataDir: '.humanink'\n        provider: 'deepseek'\n        model: 'deepseek-chat'\n`;

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, patch, 'utf8');
console.log(outputFile);