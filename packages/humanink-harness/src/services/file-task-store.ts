import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskRecord, TaskStore } from '../runtime/task-runtime.js';

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value);
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) {
      return;
    }
    for (const item of Object.values(current as Record<string, unknown>)) {
      visit(item);
    }
    Object.freeze(current);
  };
  visit(cloned);
  return cloned;
}

function isTaskRecord(value: unknown): value is TaskRecord {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.operationId === 'string'
    && typeof record.projectId === 'string'
    && typeof record.type === 'string'
    && typeof record.status === 'string';
}

export class FileTaskStore implements TaskStore {
  private readonly tasksPath: string;

  constructor(rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
    this.tasksPath = join(rootDir, 'tasks.jsonl');
    if (!existsSync(this.tasksPath)) {
      writeFileSync(this.tasksPath, '', 'utf8');
    }
  }

  load(): readonly TaskRecord[] {
    const latest = new Map<string, TaskRecord>();
    const text = readFileSync(this.tasksPath, 'utf8');
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch (error) {
        throw new Error(`Invalid task JSONL record at line ${index + 1}`, { cause: error });
      }
      if (!isTaskRecord(parsed)) {
        throw new TypeError(`Invalid task record at line ${index + 1}`);
      }
      latest.set(parsed.id, cloneAndFreeze(parsed));
    }
    return Object.freeze([...latest.values()].map(cloneAndFreeze));
  }

  save(task: TaskRecord): void {
    const previous = readFileSync(this.tasksPath, 'utf8');
    const tempPath = `${this.tasksPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      writeFileSync(tempPath, `${previous}${JSON.stringify(task)}\n`, 'utf8');
      renameSync(tempPath, this.tasksPath);
    } finally {
      if (existsSync(tempPath)) {
        rmSync(tempPath, { force: true });
      }
    }
  }
}
