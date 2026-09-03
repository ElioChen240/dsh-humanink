declare module 'node:fs' {
  interface FsLike {
    readFileSync(path: string, encoding: 'utf8'): string;
    readdirSync(path: string): string[];
  }
  const fs: FsLike;
  export default fs;
}

declare module 'node:path' {
  interface PathLike {
    resolve(...segments: string[]): string;
    join(...segments: string[]): string;
  }
  const path: PathLike;
  export default path;
}

declare const process: {
  cwd(): string;
};