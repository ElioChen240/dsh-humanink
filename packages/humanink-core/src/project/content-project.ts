import { cloneAndFreeze } from '../shared/immutability.js';
import { resolveClock, resolveIdFactory, type FactoryDependencies } from '../shared/factories.js';
import type { JsonObject } from '../shared/types.js';

export type ContentProjectStatus = 'active' | 'archived';

export interface ContentProject {
  readonly id: string;
  readonly title: string;
  readonly status: ContentProjectStatus;
  readonly creatorProfileId?: string;
  readonly currentVersionId?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly metadata: JsonObject;
}

export interface CreateContentProjectInput {
  readonly title: string;
  readonly id?: string;
  readonly status?: ContentProjectStatus;
  readonly creatorProfileId?: string;
  readonly currentVersionId?: string;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  readonly metadata?: JsonObject;
}

export function createContentProject(
  input: CreateContentProjectInput,
  dependencies?: FactoryDependencies,
): ContentProject {
  const clock = resolveClock(dependencies);
  const idFactory = resolveIdFactory(dependencies);
  const createdAt = input.createdAt ?? clock();
  const updatedAt = input.updatedAt ?? createdAt;

  const project: ContentProject = {
    id: input.id ?? idFactory('project'),
    title: input.title,
    status: input.status ?? 'active',
    createdAt: new Date(createdAt.getTime()),
    updatedAt: new Date(updatedAt.getTime()),
    metadata: cloneAndFreeze(input.metadata ?? {}),
    ...(input.creatorProfileId === undefined ? {} : { creatorProfileId: input.creatorProfileId }),
    ...(input.currentVersionId === undefined ? {} : { currentVersionId: input.currentVersionId }),
  };

  return cloneAndFreeze(project);
}

export function updateContentProjectCurrentVersion(
  project: ContentProject,
  currentVersionId: string,
  updatedAt: Date,
): ContentProject {
  return createContentProject({
    ...project,
    currentVersionId,
    updatedAt,
    createdAt: project.createdAt,
    metadata: project.metadata,
  });
}

export interface CreateProjectRequest extends Omit<CreateContentProjectInput, 'id' | 'createdAt' | 'updatedAt'> {
  readonly id?: string;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface CreateProjectWithSourceRequest {
  readonly title: string;
  readonly source: import('../versioning/content-version.js').TextContentInput;
  readonly creatorProfileId?: string;
  readonly metadata?: JsonObject;
  readonly operationId?: string;
}

export interface CreateDerivedVersionRequest {
  readonly projectId: string;
  readonly parentVersionId: string;
  readonly kind: import('../versioning/content-version.js').ContentVersionKind;
  readonly content: import('../versioning/content-version.js').TextContentInput;
  readonly createdBy: import('../versioning/content-version.js').CreatedBy;
  readonly id?: string;
  readonly createdAt?: Date;
  readonly protectedFields?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly promptTemplateVersion?: string;
  readonly modelInfo?: JsonObject;
  readonly userConfirmed?: boolean;
  readonly operationId?: string;
}
