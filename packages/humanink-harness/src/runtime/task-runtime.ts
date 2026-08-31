export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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
  readonly finishedAt?: string;
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
  finishedAt?: string;
}

interface TaskWaiter {
  readonly matches: (task: TaskRecord) => boolean;
  readonly resolve: (task: TaskRecord) => void;
  readonly reject?: (error: Error) => void;
  readonly rejectWhenTerminal: boolean;
}

const terminalStatuses: ReadonlySet<TaskStatus> = new Set(['succeeded', 'failed', 'cancelled']);

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
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
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
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
  };
}

export class TaskRuntime {
  private readonly tasks = new Map<string, MutableTask>();
  private readonly waiters = new Map<string, TaskWaiter[]>();
  private readonly idFactory: (prefix: string) => string;
  private readonly clock: () => Date;
  private readonly store: TaskStore | undefined;

  constructor(dependencies: TaskRuntimeDependencies = {}) {
    this.idFactory = dependencies.idFactory ?? defaultIdFactory;
    this.clock = dependencies.clock ?? defaultClock;
    this.store = dependencies.store;
    for (const record of this.store?.load() ?? []) {
      const restored = mutableFromRecord(record);
      if (!terminalStatuses.has(restored.status)) {
        restored.status = 'failed';
        restored.errorCode = 'TASK_INTERRUPTED';
        restored.safeMessage = '任务因进程中断而失败，请重新执行';
        restored.finishedAt = this.clock().toISOString();
        this.store?.save(snapshot(restored));
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
    this.persist(task);

    if (input.signal !== undefined) {
      if (input.signal.aborted) {
        this.cancel(id);
      } else {
        input.signal.addEventListener('abort', () => this.cancel(id), { once: true });
      }
    }

    void Promise.resolve().then(() => this.execute(task));
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
    task.controller.abort();
    this.finish(task, 'cancelled', 'TASK_CANCELLED', '任务已取消');
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

  private async execute(task: MutableTask): Promise<void> {
    if (task.status !== 'queued') {
      return;
    }
    task.status = 'running';
    task.startedAt = this.clock().toISOString();
    this.publish(task);

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
          this.publish(task);
        },
      });
      if (task.controller.signal.aborted) {
        this.finish(task, 'cancelled', 'TASK_CANCELLED', '任务已取消');
        return;
      }
      task.result = result;
      this.finish(task, 'succeeded');
    } catch (error) {
      if (task.controller.signal.aborted || isAbortError(error)) {
        this.finish(task, 'cancelled', 'TASK_CANCELLED', '任务已取消');
        return;
      }
      this.finish(task, 'failed', 'TASK_FAILED', '任务执行失败');
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
    if (errorCode !== undefined) {
      task.errorCode = errorCode;
    }
    if (safeMessage !== undefined) {
      task.safeMessage = safeMessage;
    }
    this.publish(task);
  }

  private addWaiter(taskId: string, waiter: TaskWaiter): void {
    const waiters = this.waiters.get(taskId) ?? [];
    waiters.push(waiter);
    this.waiters.set(taskId, waiters);
  }

  private persist(task: MutableTask): void {
    this.store?.save(snapshot(task));
  }

  private publish(task: MutableTask): void {
    this.persist(task);
    this.notify(task);
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
