import {
  Injectable,
  type MessageEvent,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Observable, Subject, map } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { JobProgressEvent, JobProgressStreamEvent } from './jobs.types';

const REPLAY_LIMIT = 1000;
const REPLAY_TTL_MS = 10 * 60 * 1000;

interface StoredEventFrame {
  id: string;
  event: JobProgressStreamEvent;
  expiresAt: number;
}

@Injectable()
export class JobsEventsService implements OnModuleDestroy {
  private readonly allStreamSubject = new Subject<StoredEventFrame>();
  private readonly replayFrames = new Map<string, StoredEventFrame>();
  private readonly streamInstance = randomUUID();
  private sequence = 0;
  private shuttingDown = false;

  onModuleDestroy(): void {
    this.shuttingDown = true;
    // Completing the live source completes each outer SSE subscriber, whose
    // teardown clears its own heartbeat and unsubscribes the live listener.
    this.allStreamSubject.complete();
    this.replayFrames.clear();
  }

  getAllStream(): Observable<JobProgressStreamEvent> {
    return this.allStreamSubject.pipe(map((frame) => frame.event));
  }

  getSseStream(lastEventId?: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      if (this.shuttingDown) {
        subscriber.complete();
        return;
      }
      const now = Date.now();
      for (const [id, frame] of this.replayFrames) {
        if (frame.expiresAt <= now) this.replayFrames.delete(id);
      }
      // A process-scoped cursor can resume even after its own frame was evicted.
      // New connections never receive historical job notifications.
      const prefix = `${this.streamInstance}:`;
      const rawSequence = lastEventId?.startsWith(prefix)
        ? lastEventId.slice(prefix.length)
        : '';
      const after = /^\d+$/.test(rawSequence) ? Number(rawSequence) : null;
      if (
        after !== null &&
        Number.isSafeInteger(after) &&
        after <= this.sequence
      ) {
        for (const frame of this.replayFrames.values()) {
          if (Number(frame.id.slice(prefix.length)) > after) {
            subscriber.next({ id: frame.id, data: frame.event });
          }
        }
      }
      let deliveredCursor = `${this.streamInstance}:${this.sequence}`;
      subscriber.next({
        type: 'stream-ready',
        id: deliveredCursor,
        data: {},
      });
      if (subscriber.closed) return;
      const subscription = this.allStreamSubject.subscribe({
        next: (frame) => {
          deliveredCursor = frame.id;
          subscriber.next({ id: frame.id, data: frame.event });
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      if (subscriber.closed) return () => subscription.unsubscribe();
      // Nest auto-generates an id when omitted. Repeat the delivered cursor so
      // named heartbeats keep native EventSource reconnection resumable.
      const heartbeat = setInterval(() => {
        subscriber.next({
          type: 'heartbeat',
          id: deliveredCursor,
          data: { timestamp: new Date().toISOString() },
        });
      }, 15000);
      heartbeat.unref();
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }

  publish(jobId: string, event: JobProgressEvent): void {
    if (this.shuttingDown) return;
    const now = Date.now();
    const frame: StoredEventFrame = {
      id: `${this.streamInstance}:${++this.sequence}`,
      event: { ...event, jobId, type: event.phase },
      expiresAt: now + REPLAY_TTL_MS,
    };
    this.replayFrames.set(frame.id, frame);
    for (const [id, cached] of this.replayFrames) {
      if (cached.expiresAt <= now) this.replayFrames.delete(id);
    }
    while (this.replayFrames.size > REPLAY_LIMIT) {
      const oldest = this.replayFrames.keys().next();
      if (oldest.done) break;
      this.replayFrames.delete(oldest.value);
    }
    this.allStreamSubject.next(frame);
  }
}
