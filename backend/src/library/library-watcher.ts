import { watch, type FSWatcher } from 'node:fs';
import type { LibraryWatchStatus } from './scan-history.types';

export class LibraryWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly dirty = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  private running = false;
  private overflow = 0;
  private readonly errors: string[] = [];

  constructor(
    readonly enabled: boolean,
    private readonly reconcile: (directories: string[]) => Promise<void>,
    private readonly watchDirectory: typeof watch = watch,
    private readonly limit = 2048,
  ) {}

  visit(directory: string): void {
    if (!this.enabled || this.closed || this.watchers.has(directory)) return;
    if (this.watchers.size >= this.limit) {
      this.overflow++;
      return;
    }
    try {
      const watcher = this.watchDirectory(directory, () =>
        this.markDirty(directory),
      );
      watcher.on('error', (error: Error) => {
        this.recordError(error);
        watcher.close();
        this.watchers.delete(directory);
      });
      this.watchers.set(directory, watcher);
    } catch (error) {
      this.recordError(error);
    }
  }

  private recordError(error: unknown): void {
    if (this.errors.length === 10) this.errors.shift();
    this.errors.push(String(error).slice(0, 1024));
  }

  markDirty(directory: string): void {
    if (this.closed || !this.enabled || !this.watchers.has(directory)) return;
    this.dirty.add(directory);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 2000);
    }
  }

  async flush(): Promise<void> {
    if (this.running || this.closed || !this.dirty.size) return;
    const directories = [...this.dirty];
    this.dirty.clear();
    this.running = true;
    try {
      await this.reconcile(directories);
    } catch (error) {
      this.recordError(error);
    } finally {
      this.running = false;
      if (this.dirty.size && !this.timer && !this.closed) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush();
        }, 2000);
      }
    }
  }

  retain(directories: ReadonlySet<string>): void {
    for (const [directory, watcher] of this.watchers) {
      if (directories.has(directory)) continue;
      watcher.close();
      this.watchers.delete(directory);
      this.dirty.delete(directory);
    }
  }

  status(): LibraryWatchStatus {
    return {
      enabled: this.enabled,
      watching: this.watchers.size,
      dirtyDirectories: this.dirty.size,
      reconciling: this.running,
      overflow: this.overflow,
      errors: [...this.errors],
    };
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.dirty.clear();
  }
}
