export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type TaskDurability = 'failed';

export interface TaskRecord {
  readonly id: string;
  readonly operationId: string;
  readonly projectId: string;
  readonly type: string;
  readonly status: TaskStatus;
  readonly contentVersionId?: string;
  readonly result?: unknown;
  readonly errorCode?: string;
  readonly safeMessage?: string;
  readonly startedAt?: string;
  readonly cancellationRequested?: true;
  readonly cancelRequestedAt?: string;
  readonly finishedAt?: string;
  readonly durability?: TaskDurability;
}

export interface TaskStore {
  load(): readonly TaskRecord[];
  save(task: TaskRecord): void;
}

export interface TaskStartInput {
  readonly projectId: string;
  readonly type: string;
  readonly operationId?: string;
  readonly signal?: AbortSignal;
}

export interface TaskExecutionContext {
  readonly signal: AbortSignal;
  readonly operationId: string;
  readonly update: (update: { readonly contentVersionId?: string }) => void;
}

export type TaskOperation<T> = (context: TaskExecutionContext) => Promise<T>;

export interface TaskRuntimeDependencies {
  readonly idFactory?: (prefix: string) => string;
  readonly clock?: () => Date;
  readonly store?: TaskStore;
  readonly resolveCommittedVersionId?: (operationId: string) => string | null;
}

interface MutableTask {
  readonly id: string;
  readonly operationId: string;
  readonly projectId: string;
  readonly type: string;
  readonly controller: AbortController;
  readonly operation: TaskOperation<unknown>;
  status: TaskStatus;
  contentVersionId?: string;
  result?: unknown;
  errorCode?: string;
  safeMessage?: string;
  startedAt?: string;
  cancellationRequested?: true;
  cancelRequestedAt?: string;
  finishedAt?: string;
  durability?: TaskDurability;
  externalSignal?: AbortSignal;
  externalAbortListener?: () => void;
}

interface TaskWaiter {
  readonly matches: (task: TaskRecord) => boolean;
  readonly resolve: (task: TaskRecord) => void;
  readonly reject?: (error: Error) => void;
  readonly rejectWhenTerminal: boolean;
}

const terminalStatuses: ReadonlySet<TaskStatus> = new Set(['succeeded', 'failed', 'cancelled']);

const safeFailureMessages = Object.freeze({
  LLM_TIMEOUT: '模型请求超时，请稍后重试',
  LLM_INVALID_RESPONSE: '模型返回格式无效，请重试或调整输入',
  LLM_PROVIDER_FAILED: '模型服务暂时不可用，请稍后重试',
  HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED: '保护字段校验失败，请核对后重试',
  HUMANINK_CAPABILITY_UNAVAILABLE: '当前 HumanInk 能力不可用，请检查配置',
} as const);

function safeFailure(error: unknown): { readonly errorCode: string; readonly safeMessage: string } {
  if (error !== null && typeof error === 'object') {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string' && Object.hasOwn(safeFailureMessages, code)) {
      return {
        errorCode: code,
        safeMessage: safeFailureMessages[code as keyof typeof safeFailureMessages],
      };
    }
  }
  return { errorCode: 'TASK_FAILED', safeMessage: '任务执行失败' };
}

function defaultIdFactory(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function defaultClock(): Date {
  return new Date();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value);
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object' || seen.has(current)) {
      return;
    }
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      visit((current as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(current);
  };
  visit(cloned);
  return cloned;
}

function snapshot(task: MutableTask): TaskRecord {
  return Object.freeze({
    id: task.id,
    operationId: task.operationId,
    projectId: task.projectId,
    type: task.type,
    status: task.status,
    ...(task.contentVersionId === undefined ? {} : { contentVersionId: task.contentVersionId }),
    ...(task.result === undefined ? {} : { result: cloneAndFreeze(task.result) }),
    ...(task.errorCode === undefined ? {} : { errorCode: task.errorCode }),
    ...(task.safeMessage === undefined ? {} : { safeMessage: task.safeMessage }),
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.cancellationRequested === true ? { cancellationRequested: true as const } : {}),
    ...(task.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: task.cancelRequestedAt }),
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
    ...(task.durability === undefined ? {} : { durability: task.durability }),
  });
}

function mutableFromRecord(record: TaskRecord): MutableTask {
  return {
    id: record.id,
    operationId: record.operationId,
    projectId: record.projectId,
    type: record.type,
    controller: new AbortController(),
    operation: async () => record.result,
    status: record.status,
    ...(record.contentVersionId === undefined ? {} : { contentVersionId: record.contentVersionId }),
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
    ...(record.safeMessage === undefined ? {} : { safeMessage: record.safeMessage }),
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.cancellationRequested === true ? { cancellationRequested: true as const } : {}),
    ...(record.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: record.cancelRequestedAt }),
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.durability === undefined ? {} : { durability: record.durability }),
  };
}

export class TaskRuntime {
  private readonly tasks = new Map<string, MutableTask>();
  private readonly waiters = new Map<string, TaskWaiter[]>();
  private readonly idFactory: (prefix: string) => string;
  private readonly clock: () => Date;
  private readonly store: TaskStore | undefined;
  private readonly resolveCommittedVersionId: ((operationId: string) => string | null) | undefined;

  constructor(dependencies: TaskRuntimeDependencies = {}) {
    this.idFactory = dependencies.idFactory ?? defaultIdFactory;
    this.clock = dependencies.clock ?? defaultClock;
    this.store = dependencies.store;
    this.resolveCommittedVersionId = dependencies.resolveCommittedVersionId;
    for (const record of this.store?.load() ?? []) {
      const restored = mutableFromRecord(record);
      if (!terminalStatuses.has(restored.status)) {
        this.recover(restored);
        this.persist(restored);
      }
      this.tasks.set(restored.id, restored);
    }
  }

  start<T>(input: TaskStartInput, operation: TaskOperation<T>): TaskRecord {
    const id = this.idFactory('task');
    const task: MutableTask = {
      id,
      operationId: input.operationId ?? id,
      projectId: input.projectId,
      type: input.type,
      controller: new AbortController(),
      operation: operation as TaskOperation<unknown>,
      status: 'queued',
    };
    this.tasks.set(id, task);

    if (!this.persist(task)) {
      this.failForStore(task);
      return snapshot(task);
    }

    if (input.signal !== undefined) {
      if (input.signal.aborted) {
        this.cancel(id);
      } else {
        const listener = (): void => {
          this.cancel(id);
        };
        task.externalSignal = input.signal;
        task.externalAbortListener = listener;
        input.signal.addEventListener('abort', listener, { once: true });
      }
    }

    if (task.status === 'queued') {
      void Promise.resolve()
        .then(() => this.execute(task))
        .catch(() => this.handleBackgroundFailure(task));
    }
    return snapshot(task);
  }

  get(taskId: string): TaskRecord | null {
    const task = this.tasks.get(taskId);
    return task === undefined ? null : snapshot(task);
  }

  list(projectId?: string): readonly TaskRecord[] {
    const tasks = [...this.tasks.values()]
      .filter((task) => projectId === undefined || task.projectId === projectId)
      .map(snapshot);
    return Object.freeze(tasks);
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task === undefined || terminalStatuses.has(task.status)) {
      return false;
    }
    if (task.cancellationRequested === true) {
      return true;
    }

    task.cancellationRequested = true;
    task.cancelRequestedAt = this.clock().toISOString();
    if (task.status === 'queued') {
      task.controller.abort();
      this.finish(task, 'cancelled', 'TASK_CANCELLED', '任务已取消');
      return true;
    }

    task.controller.abort();
    if (!this.publish(task)) {
      this.failForStore(task);
    }
    return true;
  }

  waitForTerminal(taskId: string): Promise<TaskRecord> {
    const task = this.requireTask(taskId);
    if (terminalStatuses.has(task.status)) {
      return Promise.resolve(snapshot(task));
    }
    return new Promise((resolve) => {
      this.addWaiter(taskId, {
        matches: (current) => terminalStatuses.has(current.status),
        resolve,
        rejectWhenTerminal: false,
      });
    });
  }

  waitForStatus(taskId: string, status: TaskStatus): Promise<TaskRecord> {
    const task = this.requireTask(taskId);
    if (task.status === status) {
      return Promise.resolve(snapshot(task));
    }
    if (terminalStatuses.has(task.status)) {
      return Promise.reject(new Error(`Task ${taskId} settled as ${task.status} before reaching ${status}`));
    }
    return new Promise((resolve, reject) => {
      this.addWaiter(taskId, {
        matches: (current) => current.status === status,
        resolve,
        reject,
        rejectWhenTerminal: true,
      });
    });
  }

  private requireTask(taskId: string): MutableTask {
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private recover(task: MutableTask): void {
    task.finishedAt = this.clock().toISOString();
    if (task.contentVersionId === undefined) {
      const recoveredVersionId = this.resolveCommittedVersionId?.(task.operationId) ?? null;
      if (recoveredVersionId !== null) {
        task.contentVersionId = recoveredVersionId;
      }
    }

    if (task.result !== undefined) {
      task.status = 'succeeded';
      delete task.errorCode;
      delete task.safeMessage;
      return;
    }
    if (task.contentVersionId !== undefined) {
      task.status = 'failed';
      task.errorCode = 'TASK_RECOVERY_REQUIRED';
      task.safeMessage = '内容已保存，但任务结果未完整持久化，请人工核对';
      return;
    }
    if (task.cancellationRequested === true) {
      task.status = 'cancelled';
      task.errorCode = 'TASK_CANCELLED';
      task.safeMessage = '任务已取消';
      return;
    }
    task.status = 'failed';
    task.errorCode = 'TASK_INTERRUPTED';
    task.safeMessage = '任务因进程中断而失败，请重新执行';
  }

  private async execute(task: MutableTask): Promise<void> {
    if (task.status !== 'queued') {
      return;
    }
    if (task.controller.signal.aborted) {
      this.finish(task, 'cancelled', 'TASK_CANCELLED', '任务已取消');
      return;
    }

    task.status = 'running';
    task.startedAt = this.clock().toISOString();
    if (!this.publish(task)) {
      task.controller.abort();
      this.failForStore(task);
      return;
    }

    try {
      const result = await task.operation({
        signal: task.controller.signal,
        operationId: task.operationId,
        update: (update) => {
          if (task.status !== 'running') {
            return;
          }
          if (update.contentVersionId !== undefined) {
            task.contentVersionId = update.contentVersionId;
          }
          if (!this.publish(task)) {
            task.controller.abort();
            this.failForStore(task);
            throw new Error('TASK_STORE_FAILED');
          }
        },
      });
      if (terminalStatuses.has(task.status)) {
        return;
      }
      task.result = result;
      this.persist(task);
      this.finish(task, 'succeeded');
    } catch (error) {
      if (terminalStatuses.has(task.status)) {
        return;
      }
      if (isAbortError(error)) {
        this.finish(task, 'cancelled', 'TASK_CANCELLED', '任务已取消');
        return;
      }
      const failure = safeFailure(error);
      this.finish(task, 'failed', failure.errorCode, failure.safeMessage);
    }
  }

  private finish(
    task: MutableTask,
    status: Extract<TaskStatus, 'succeeded' | 'failed' | 'cancelled'>,
    errorCode?: string,
    safeMessage?: string,
  ): void {
    if (terminalStatuses.has(task.status)) {
      return;
    }
    task.status = status;
    task.finishedAt = this.clock().toISOString();
    if (status === 'succeeded') {
      delete task.errorCode;
      delete task.safeMessage;
    } else {
      if (errorCode !== undefined) {
        task.errorCode = errorCode;
      }
      if (safeMessage !== undefined) {
        task.safeMessage = safeMessage;
      }
    }
    this.cleanupExternalSignal(task);
    this.publish(task);
  }

  private failForStore(task: MutableTask): void {
    if (terminalStatuses.has(task.status)) {
      return;
    }
    task.status = 'failed';
    task.errorCode = 'TASK_STORE_FAILED';
    task.safeMessage = '任务状态保存失败，请重新执行';
    task.finishedAt = this.clock().toISOString();
    task.durability = 'failed';
    this.cleanupExternalSignal(task);
    this.notify(task);
  }

  private handleBackgroundFailure(task: MutableTask): void {
    if (terminalStatuses.has(task.status)) {
      return;
    }
    this.finish(task, 'failed', 'TASK_FAILED', '任务执行失败');
  }

  private cleanupExternalSignal(task: MutableTask): void {
    if (task.externalSignal !== undefined && task.externalAbortListener !== undefined) {
      task.externalSignal.removeEventListener('abort', task.externalAbortListener);
      delete task.externalSignal;
      delete task.externalAbortListener;
    }
  }

  private addWaiter(taskId: string, waiter: TaskWaiter): void {
    const waiters = this.waiters.get(taskId) ?? [];
    waiters.push(waiter);
    this.waiters.set(taskId, waiters);
  }

  private persist(task: MutableTask): boolean {
    if (this.store === undefined) {
      delete task.durability;
      return true;
    }
    delete task.durability;
    try {
      this.store.save(snapshot(task));
      return true;
    } catch {
      task.durability = 'failed';
      return false;
    }
  }

  private publish(task: MutableTask): boolean {
    const persisted = this.persist(task);
    this.notify(task);
    return persisted;
  }

  private notify(task: MutableTask): void {
    const current = snapshot(task);
    const waiters = this.waiters.get(task.id);
    if (waiters === undefined) {
      return;
    }
    const remaining: TaskWaiter[] = [];
    for (const waiter of waiters) {
      if (waiter.matches(current)) {
        waiter.resolve(current);
      } else if (waiter.rejectWhenTerminal && terminalStatuses.has(current.status)) {
        waiter.reject?.(new Error(`Task ${task.id} settled as ${current.status} before reaching the requested status`));
      } else {
        remaining.push(waiter);
      }
    }
    if (remaining.length === 0) {
      this.waiters.delete(task.id);
    } else {
      this.waiters.set(task.id, remaining);
    }
  }
}