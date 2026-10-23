import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

export interface JobCancellationControl {
  signal: AbortSignal;
  checkpoint: () => Promise<void>;
  stop: () => void;
}

export class JobInterruptionError extends Error {
  constructor(readonly reason: 'user' | 'stalled') {
    super(
      reason === 'stalled'
        ? 'Job stopped: worker stalled or server restarted during processing'
        : 'Job cancelled by user',
    );
    this.name = 'JobInterruptionError';
  }
}

@Injectable()
export class JobCancellationService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly logger = new Logger(JobCancellationService.name);
  private lastPollWarningAt = 0;
  constructor(@InjectQueue('translation') private readonly queue: Queue) {}
  private key(id: string): string {
    return this.queue.toKey(`cancel:${id}`);
  }
  async request(
    id: string,
    reason: 'user' | 'stalled' = 'user',
  ): Promise<void> {
    await this.queue.client.set(this.key(id), reason, 'EX', 604800);
    this.controllers.get(id)?.abort(new JobInterruptionError(reason));
  }
  async isRequested(id: string): Promise<boolean> {
    return (await this.queue.client.exists(this.key(id))) === 1;
  }
  async start(id: string): Promise<JobCancellationControl> {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const checkpoint = async () => {
      const reason = await this.queue.client.get(this.key(id));
      if (reason)
        controller.abort(
          new JobInterruptionError(reason === 'stalled' ? 'stalled' : 'user'),
        );
      controller.signal.throwIfAborted();
    };
    // Requests from another API process must also interrupt an in-flight provider call.
    const timer = setInterval(() => {
      void checkpoint().catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          Date.now() - this.lastPollWarningAt >= 30000
        ) {
          this.lastPollWarningAt = Date.now();
          this.logger.warn(
            `Cancellation poll failed for ${id}: ${String(error)}`,
          );
        }
      });
    }, 250);
    timer.unref();
    try {
      await checkpoint();
    } catch (error) {
      clearInterval(timer);
      this.controllers.delete(id);
      throw error;
    }
    return {
      signal: controller.signal,
      checkpoint,
      stop: () => {
        clearInterval(timer);
        this.controllers.delete(id);
      },
    };
  }
  async clear(id: string): Promise<void> {
    await this.queue.client.eval(
      "if redis.call('EXISTS',KEYS[1]) == 0 then return redis.call('DEL',KEYS[2]) end return 0",
      2,
      this.queue.toKey(id),
      this.key(id),
    );
  }
}
