import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requiredFiles = [
  'README.md',
  'VERSION',
  'cordis.patch.yml',
  'dist/bundle/index.mjs',
  'dist/bundle/client.js',
];

async function exists(relativePath) {
  try { await access(join(root, relativePath)); return true; } catch { return false; }
}

async function readUtf8(relativePath) {
  return readFile(join(root, relativePath), 'utf8');
}

export async function runReleaseChecks() {
  const errors = [];
  for (const relativePath of requiredFiles) {
    if (!(await exists(relativePath))) errors.push(`missing required release file: ${relativePath}`);
  }

  let manifest;
  try { manifest = JSON.parse(await readUtf8('package.json')); } catch { errors.push('package.json is not valid JSON'); }
  if (manifest) {
    if (manifest.private) errors.push('package.json must be publishable');
    if (manifest.main !== './dist/bundle/index.mjs') errors.push('package.json main must point to the host bundle');
    if (manifest.exports?.['./client']?.default !== './dist/bundle/client.js') errors.push('package.json client export is missing');
    for (const file of ['dist/bundle', 'cordis.patch.yml', 'README.md', 'VERSION']) {
      if (!manifest.files?.includes(file)) errors.push(`package.json files is missing ${file}`);
    }
    if (!manifest.dsh?.bundle?.patch || !manifest.dsh?.client?.platform) errors.push('DSH bundle/client manifest is incomplete');
  }

  if (await exists('cordis.patch.yml')) {
    const patch = await readUtf8('cordis.patch.yml');
    if (!patch.includes('id: dsh-humanink') || !patch.includes('name: dsh-humanink')) errors.push('cordis.patch.yml does not register dsh-humanink');
  }
  if (await exists('README.md')) {
    const readme = await readUtf8('README.md');
    for (const marker of ['dsh-humanink', 'DeepSeek Harness', 'pnpm', 'MVP']) {
      if (!readme.includes(marker)) errors.push(`README.md is missing ${marker}`);
    }
  }
  for (const relativePath of ['README.md', 'VERSION', 'cordis.patch.yml']) {
    if (await exists(relativePath)) {
      const bytes = await readFile(join(root, relativePath));
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) errors.push(`${relativePath} must not contain a UTF-8 BOM`);
      if (bytes.includes(13)) errors.push(`${relativePath} must use LF line endings`);
    }
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = await runReleaseChecks();
  if (!result.ok) { for (const error of result.errors) console.error(`release check: ${error}`); process.exitCode = 1; }
  else console.log('HumanInk release checks passed.');
}
