import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { cloneAndFreeze, type ContentProject, type ContentVersion } from '@humanink/core';

interface StoredProject {
  readonly id: string;
  readonly title: string;
  readonly status: ContentProject['status'];
  readonly creatorProfileId?: string;
  readonly currentVersionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: ContentProject['metadata'];
}

interface WorkbenchMetadata {
  readonly schemaVersion: 1;
  readonly project: StoredProject;
  readonly currentVersionId: string;
  readonly currentVersionKind: ContentVersion['kind'];
}

function markdownOf(version: ContentVersion): string {
  const title = version.content.title.trim();
  const body = version.content.body.trim();
  return title.length === 0 ? `${body}\n` : `# ${title}\n\n${body}\n`;
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export class FileWorkbenchRepository {
  private readonly root: string;
  private revision = 0;

  constructor(libraryRoot: string) {
    this.root = resolve(libraryRoot);
    mkdirSync(this.root, { recursive: true });
  }

  getRevision(): number { return this.revision; }

  async saveSnapshot(project: ContentProject, version: ContentVersion): Promise<void> {
    if (version.projectId !== project.id) throw new TypeError('Version projectId must match project id');
    const directory = this.resolveProjectDirectory(project.id);
    const versionsDirectory = this.resolveInside(directory, 'versions');
    mkdirSync(versionsDirectory, { recursive: true });
    const markdown = markdownOf(version);
    atomicWrite(this.resolveInside(versionsDirectory, `${version.id}.md`), markdown);
    atomicWrite(this.resolveInside(directory, 'article.md'), markdown);
    const metadata: WorkbenchMetadata = {
      schemaVersion: 1,
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        ...(project.creatorProfileId === undefined ? {} : { creatorProfileId: project.creatorProfileId }),
        ...(project.currentVersionId === undefined ? {} : { currentVersionId: project.currentVersionId }),
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        metadata: project.metadata,
      },
      currentVersionId: version.id,
      currentVersionKind: version.kind,
    };
    atomicWrite(this.resolveInside(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    this.revision += 1;
  }

  async listProjects(): Promise<readonly ContentProject[]> {
    const projects: ContentProject[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = this.resolveInside(this.root, entry.name, 'metadata.json');
      if (!existsSync(path)) continue;
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkbenchMetadata>;
        const item = raw.project;
        if (raw.schemaVersion !== 1 || item === undefined || typeof item.id !== 'string' || typeof item.title !== 'string') continue;
        projects.push(cloneAndFreeze({
          id: item.id,
          title: item.title,
          status: item.status === 'archived' ? 'archived' : 'active',
          ...(typeof item.creatorProfileId === 'string' ? { creatorProfileId: item.creatorProfileId } : {}),
          ...(typeof item.currentVersionId === 'string' ? { currentVersionId: item.currentVersionId } : {}),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          metadata: typeof item.metadata === 'object' && item.metadata !== null ? item.metadata : {},
        }));
      } catch {
        // A malformed neighboring directory must not make the whole library unavailable.
      }
    }
    return cloneAndFreeze(projects.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()));
  }

  private resolveProjectDirectory(projectId: string): string {
    if (projectId.trim().length === 0 || projectId.includes('/') || projectId.includes('\\') || projectId === '.' || projectId === '..') {
      throw new Error('Resolved project path is outside the configured library root');
    }
    return this.resolveInside(this.root, projectId);
  }

  private resolveInside(base: string, ...segments: string[]): string {
    const target = resolve(base, ...segments);
    const fromRoot = relative(this.root, target);
    if (fromRoot === '..' || fromRoot.startsWith(`..\\`) || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
      throw new Error('Resolved project path is outside the configured library root');
    }
    return target;
  }
}