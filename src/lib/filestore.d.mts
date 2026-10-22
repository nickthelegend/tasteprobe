export function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T>;
export function writeFileAtomic(file: string, data: string, mode?: number): Promise<void>;
export function readJsonFile<T>(file: string, fallback: T): Promise<T>;
export function updateJsonFile<T>(file: string, fallback: T, mutate: (current: T) => T | void | Promise<T | void>): Promise<T>;
export function coalescingWriter(write: () => Promise<unknown>): { schedule(): Promise<void>; drain(): Promise<void> };
