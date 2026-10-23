interface Waiter {
  resolve: (release: () => void) => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
}
export function translationAbortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('Translation cancelled', { cause: reason });
  error.name = 'AbortError';
  return error;
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw translationAbortError(signal);
}
/** One bounded FIFO per provider, shared by every translation entry point. */
export class ProviderLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];
  constructor(
    private readonly concurrency: number,
    private readonly maxQueued = 1024,
  ) {}
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const release = await this.acquire(signal);
    try {
      throwIfAborted(signal);
      return await operation();
    } finally {
      release();
    }
  }
  private acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (this.active < this.concurrency) {
        this.active++;
        resolve(this.releasePermit());
        return;
      }
      if (this.queue.length >= this.maxQueued) {
        reject(new Error('Provider request queue is full'));
        return;
      }
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(translationAbortError(signal));
        },
      };
      this.queue.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      if (signal?.aborted) waiter.abort();
    });
  }
  private releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next.signal?.removeEventListener('abort', next.abort);
        next.resolve(this.releasePermit());
      } else this.active--;
    };
  }
}
