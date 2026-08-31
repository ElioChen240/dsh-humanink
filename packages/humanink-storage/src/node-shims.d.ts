declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { readonly recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function rmSync(path: string, options?: { readonly recursive?: boolean; readonly force?: boolean }): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
}
