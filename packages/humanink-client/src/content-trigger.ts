import type { HumanInkClientApi, ProjectSummary } from './api.js';

export interface ContentMention {
  readonly type: 'humanink-content';
  readonly contentId: string;
  readonly title: string;
  readonly versionId: string;
}

export interface ContentMentionSeed {
  readonly contentId: string;
  readonly title: string;
  readonly versionId: string;
}

export function createContentMention(seed: ContentMentionSeed): ContentMention {
  return { type: 'humanink-content', contentId: seed.contentId, title: seed.title, versionId: seed.versionId };
}

export function formatContentMention(mention: ContentMention): string {
  return `@文章：${mention.title}`;
}

function mentionFromProject(project: ProjectSummary): ContentMention | undefined {
  return project.activeVersionId ? createContentMention({ contentId: project.id, title: project.title, versionId: project.activeVersionId }) : undefined;
}

export async function searchContentMentions(api: Pick<HumanInkClientApi, 'listProjects'>, query: string, signal?: AbortSignal): Promise<ContentMention[]> {
  const needle = query.trim().toLocaleLowerCase();
  const projects = await api.listProjects(signal);
  return projects
    .filter((project) => needle.length === 0 || project.title.toLocaleLowerCase().includes(needle))
    .map(mentionFromProject)
    .filter((mention): mention is ContentMention => mention !== undefined);
}

export function parseContentMention(input: string, mentions: readonly ContentMention[]): ContentMention | undefined {
  const title = input.trim().replace(/^@文章[：:]?\s*/, '');
  return mentions.find((mention) => mention.title === title);
}
