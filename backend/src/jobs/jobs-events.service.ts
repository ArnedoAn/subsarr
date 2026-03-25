import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { type JobProgressEvent } from './jobs.types';

@Injectable()
export class JobsEventsService {
  private readonly streams = new Map<string, Subject<JobProgressEvent>>();

  getStream(jobId: string): Subject<JobProgressEvent> {
    const existing = this.streams.get(jobId);
    if (existing) {
      return existing;
    }

    const subject = new Subject<JobProgressEvent>();
    this.streams.set(jobId, subject);
    return subject;
  }

  publish(jobId: string, event: JobProgressEvent): void {
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
