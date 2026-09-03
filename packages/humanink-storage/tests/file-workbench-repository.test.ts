import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createContentProject, createContentVersion } from '@humanink/core';
import { FileWorkbenchRepository } from '../src/workbench/file-workbench-repository.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixtures() {
  const project = createContentProject({ id: 'project-1', title: '我的文章', createdAt: new Date('2026-09-03T00:00:00Z') });
  const version = createContentVersion({ id: 'version-1', projectId: project.id, kind: 'source', content: { title: project.title, body: '正文内容' }, createdBy: 'user', createdAt: new Date('2026-09-03T00:00:00Z') });
  return { project: { ...project, currentVersionId: version.id }, version };
}

describe('FileWorkbenchRepository', () => {
  it('writes editable Markdown and metadata atomically, then scans them back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-workbench-')); roots.push(root);
    const repository = new FileWorkbenchRepository(root);
    const { project, version } = fixtures();

    await repository.saveSnapshot(project, version);

    const directory = join(root, project.id);
    expect(readFileSync(join(directory, 'article.md'), 'utf8')).toBe('# 我的文章\n\n正文内容\n');
    expect(readFileSync(join(directory, 'versions', 'version-1.md'), 'utf8')).toBe('# 我的文章\n\n正文内容\n');
    expect(JSON.parse(readFileSync(join(directory, 'metadata.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, project: { id: 'project-1' }, currentVersionId: 'version-1' });
    await expect(repository.listProjects()).resolves.toEqual([expect.objectContaining({ id: 'project-1', title: '我的文章' })]);
    expect(repository.getRevision()).toBeGreaterThan(0);
    expect(existsSync(join(directory, 'metadata.json.tmp'))).toBe(false);
  });

  it('ignores malformed directories and rejects paths escaping the library root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-workbench-safe-')); roots.push(root);
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'metadata.json'), '{bad json', 'utf8');
    const repository = new FileWorkbenchRepository(root);
    await expect(repository.listProjects()).resolves.toEqual([]);
    const { version } = fixtures();
    await expect(repository.saveSnapshot({ ...fixtures().project, id: '../escape' }, { ...version, projectId: '../escape' })).rejects.toThrow('outside the configured library root');
  });
});