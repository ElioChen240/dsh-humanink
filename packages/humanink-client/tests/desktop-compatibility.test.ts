import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
  exports?: Record<string, unknown>;
  dsh?: { client?: { platform?: string; inject?: string[] } };
};
const client = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'packages/humanink-client/package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  dsh?: { client?: { platform?: string; inject?: string[] } };
};

describe('DSH Desktop client compatibility contract', () => {
  it('publishes the standard web client face without Electron dependencies', () => {
    expect(root.dsh?.client?.platform).toBe('web');
    expect(root.dsh?.client?.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-ui-renderer',
    ]));
    expect(root.exports).toHaveProperty('./client');
    expect(client.dsh?.client?.platform).toBe('web');
    expect(client.dependencies).not.toHaveProperty('electron');
  });

  it('keeps the client source independent from Electron private APIs', () => {
    const sourceDir = path.resolve(process.cwd(), 'packages/humanink-client/src');
    const sourceFiles = fs.readdirSync(sourceDir).filter((file) => /\.(ts|tsx)$/.test(file));
    const source = sourceFiles.map((file) => fs.readFileSync(path.join(sourceDir, file), 'utf8')).join('\n');
    expect(source).not.toMatch(/from ['"]electron['"]|require\(['"]electron['"]\)/);
  });
});
