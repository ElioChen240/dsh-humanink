import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileContentRepository } from '../src/index.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('FileContentRepository project listing', () => {
  it('persists the latest project records and lists them newest first after restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'humanink-project-list-'));
    roots.push(root);
    const repository = new FileContentRepository(root);
    const older = await repository.createProject({
      id: 'project_older',
      title: 'Older project',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await repository.createProject({
      id: 'project_newer',
      title: 'Newer project',
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    await repository.updateProject({
      ...older,
      title: 'Older project revised',
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    });

    const restarted = new FileContentRepository(root);
    const listed = await restarted.listProjects();

    expect(listed.map((project) => [project.id, project.title])).toEqual([
      ['project_older', 'Older project revised'],
      ['project_newer', 'Newer project'],
    ]);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
  });
});