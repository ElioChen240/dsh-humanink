import { cloneAndFreeze } from '../shared/immutability.js';
import { createContentHash } from '../shared/hash.js';
import { resolveClock, resolveIdFactory, type FactoryDependencies } from '../shared/factories.js';
import type { JsonObject } from '../shared/types.js';

export type ContentVersionKind =
  | 'source'
  | 'topic'
  | 'title'
  | 'brief'
  | 'outline'
  | 'draft'
  | 'humanized'
  | 'review'
  | 'restored';

export type CreatedBy = 'user' | 'llm' | 'system';

export interface TextContent {
  readonly format: 'markdown';
  readonly title: string;
  readonly body: string;
}

export interface TextContentInput {
  readonly format?: 'markdown';
  readonly title: string;
  readonly body: string;
}

export interface ContentVersion {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ContentVersionKind;
  readonly parentVersionId?: string;
  readonly content: TextContent;
  readonly protectedFields: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly promptTemplateVersion?: string;
  readonly modelInfo?: JsonObject;
  readonly createdBy: CreatedBy;
  readonly userConfirmed: boolean;
  readonly createdAt: Date;
  readonly contentHash: string;
}

export interface CreateContentVersionInput {
  readonly id?: string;
  readonly projectId: string;
  readonly kind: ContentVersionKind;
  readonly parentVersionId?: string;
  readonly content: TextContentInput;
  readonly protectedFields?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly promptTemplateVersion?: string;
  readonly modelInfo?: JsonObject;
  readonly createdBy: CreatedBy;
  readonly userConfirmed?: boolean;
  readonly createdAt?: Date;
}

export interface DeriveContentVersionInput extends Omit<CreateContentVersionInput, 'projectId' | 'parentVersionId'> {}

export interface RestoreContentVersionInput {
  readonly id?: string;
  readonly createdBy?: CreatedBy;
  readonly createdAt?: Date;
  readonly protectedFields?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly promptTemplateVersion?: string;
  readonly modelInfo?: JsonObject;
  readonly userConfirmed?: boolean;
}

function normalizeTextContent(content: TextContentInput): TextContent {
  return cloneAndFreeze({
    format: content.format ?? 'markdown',
    title: content.title,
    body: content.body,
  });
}

export function createContentVersion(
  input: CreateContentVersionInput,
  dependencies?: FactoryDependencies,
): ContentVersion {
  const clock = resolveClock(dependencies);
  const idFactory = resolveIdFactory(dependencies);
  const content = normalizeTextContent(input.content);
  const version: ContentVersion = {
    id: input.id ?? idFactory('version'),
    projectId: input.projectId,
    kind: input.kind,
    content,
    protectedFields: [...(input.protectedFields ?? [])],
    sourceRefs: [...(input.sourceRefs ?? [])],
    createdBy: input.createdBy,
    userConfirmed: input.userConfirmed ?? false,
    createdAt: new Date((input.createdAt ?? clock()).getTime()),
    contentHash: createContentHash(content),
    ...(input.parentVersionId === undefined ? {} : { parentVersionId: input.parentVersionId }),
    ...(input.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: input.promptTemplateVersion }),
    ...(input.modelInfo === undefined ? {} : { modelInfo: cloneAndFreeze(input.modelInfo) }),
  };

  return cloneAndFreeze(version);
}

export function deriveContentVersion(
  parent: ContentVersion,
  input: DeriveContentVersionInput,
  dependencies?: FactoryDependencies,
): ContentVersion {
  return createContentVersion({
    ...input,
    projectId: parent.projectId,
    parentVersionId: parent.id,
  }, dependencies);
}

export function restoreContentVersion(
  parent: ContentVersion,
  input: RestoreContentVersionInput = {},
  dependencies?: FactoryDependencies,
): ContentVersion {
  return createContentVersion({
    projectId: parent.projectId,
    kind: 'restored',
    parentVersionId: parent.id,
    content: parent.content,
    protectedFields: input.protectedFields ?? parent.protectedFields,
    sourceRefs: input.sourceRefs ?? parent.sourceRefs,
    createdBy: input.createdBy ?? 'user',
    userConfirmed: input.userConfirmed ?? false,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.promptTemplateVersion === undefined ? {} : { promptTemplateVersion: input.promptTemplateVersion }),
    ...(input.modelInfo === undefined
      ? (parent.modelInfo === undefined ? {} : { modelInfo: parent.modelInfo })
      : { modelInfo: input.modelInfo }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  }, dependencies);
}
