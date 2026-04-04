import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { type JobProgressEvent } from './jobs.types';

@Injectable()
export class JobsEventsService {
  private readonly streams = new Map<string, Subject<JobProgressEvent>>();
  private readonly lastEvent = new Map<string, JobProgressEvent>();

  getStream(jobId: string): Subject<JobProgressEvent> {
    const existing = this.streams.get(jobId);
    if (existing) {
      return existing;
    }

    const subject = new Subject<JobProgressEvent>();
    this.streams.set(jobId, subject);
    return subject;
  }

  peekLast(jobId: string): JobProgressEvent | undefined {
    return this.lastEvent.get(jobId);
  }

  publish(jobId: string, event: JobProgressEvent): void {
    this.lastEvent.set(jobId, event);
    this.getStream(jobId).next(event);
  }

  complete(jobId: string): void {
    const stream = this.streams.get(jobId);
    if (!stream) {
      return;
    }

    stream.complete();
    this.streams.delete(jobId);
  }
}
