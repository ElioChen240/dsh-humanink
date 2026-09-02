import { describe, expect, it } from 'vitest';
import { InMemoryContentRepository } from '../src/index.js';

describe('ContentRepository project listing', () => {
  it('returns projects newest first as deeply isolated immutable snapshots', async () => {
    const repository = new InMemoryContentRepository();
    await repository.createProject({
      id: 'project_older',
      title: 'Older project',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      metadata: { channel: 'newsletter' },
    });
    await repository.createProject({
      id: 'project_newer',
      title: 'Newer project',
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      metadata: { channel: 'blog' },
    });

    const listed = await repository.listProjects();

    expect(listed.map((project) => project.id)).toEqual(['project_newer', 'project_older']);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(Object.isFrozen(listed[0]?.metadata)).toBe(true);
    expect(() => (listed as unknown[]).push({})).toThrow();
    expect(() => {
      (listed[0] as { title: string }).title = 'Changed';
    }).toThrow();

    const reread = await repository.listProjects();
    expect(reread[0]?.title).toBe('Newer project');
  });
});