import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface OverlayItem { readonly stage?: string; readonly taskId?: string; readonly sessionId?: string; }
export interface OverlayState { readonly schemaVersion: 1; readonly revision: number; readonly items: Readonly<Record<string, OverlayItem>>; }

function emptyState(): OverlayState { return { schemaVersion: 1, revision: 0, items: {} }; }

function decode(value: unknown): OverlayState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyState();
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 0 || typeof record.items !== 'object' || record.items === null || Array.isArray(record.items)) return emptyState();
  const items: Record<string, OverlayItem> = {};
  for (const [key, candidate] of Object.entries(record.items as Record<string, unknown>)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    items[key] = {
      ...(typeof item.stage === 'string' ? { stage: item.stage } : {}),
      ...(typeof item.taskId === 'string' ? { taskId: item.taskId } : {}),
      ...(typeof item.sessionId === 'string' ? { sessionId: item.sessionId } : {}),
    };
  }
  return { schemaVersion: 1, revision: record.revision, items };
}

export class OverlayStore {
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    const root = resolve(dataDir);
    mkdirSync(root, { recursive: true });
    this.path = join(root, 'overlay.json');
  }

  async read(): Promise<OverlayState> {
    await this.tail;
    return this.readNow();
  }

  update(transform: (state: OverlayState) => Omit<OverlayState, 'schemaVersion' | 'revision'> & Partial<Pick<OverlayState, 'schemaVersion' | 'revision'>>): Promise<OverlayState> {
    let result = emptyState();
    const work = this.tail.then(() => {
      const current = this.readNow();
      const proposed = transform(current);
      result = decode({ schemaVersion: 1, revision: current.revision + 1, items: proposed.items });
      this.writeNow(result);
    });
    this.tail = work.catch(() => undefined);
    return work.then(() => result);
  }

  private readNow(): OverlayState {
    if (!existsSync(this.path)) return emptyState();
    try { return decode(JSON.parse(readFileSync(this.path, 'utf8'))); } catch { return emptyState(); }
  }

  private writeNow(state: OverlayState): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    try { renameSync(temporary, this.path); } catch (error) { rmSync(temporary, { force: true }); throw error; }
  }
}