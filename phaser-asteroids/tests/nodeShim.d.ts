// The project deliberately has no @types/node. The few tests that look at files on disk only need these.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function statSync(path: string): { size: number; isDirectory(): boolean };
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
}
interface ImportMeta {
  dirname: string;
}
