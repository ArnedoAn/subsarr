import type { MessageEvent } from '@nestjs/common';
import { JobsEventsService } from './jobs-events.service';
import type {
  JobPhase,
  JobProgressEvent,
  JobProgressStreamEvent,
} from './jobs.types';

function progress(phase: JobPhase = 'translating'): JobProgressEvent {
  return {
    phase,
    progressPercent: phase === 'completed' ? 100 : 25,
    message: `Job ${phase}`,
    timestamp: new Date().toISOString(),
    details: { batch: 2 },
  };
}

describe('JobsEventsService unified resumable stream', () => {
  let service: JobsEventsService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    service = new JobsEventsService();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('multiplexes all jobs without named job-event envelopes or per-job streams', () => {
    const events: JobProgressStreamEvent[] = [];
    const subscription = service
      .getAllStream()
      .subscribe((event) => events.push(event));
    service.publish('first', progress());
    service.publish('second', progress('cancelled'));
    service.publish('third', progress('waiting'));
    expect(events.map((event) => [event.jobId, event.type])).toEqual([
      ['first', 'translating'],
      ['second', 'cancelled'],
      ['third', 'waiting'],
    ]);
    subscription.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps idle connections alive with named heartbeats and clears the timer on unsubscribe', () => {
    const frames: MessageEvent[] = [];
    const subscription = service
      .getSseStream()
      .subscribe((frame) => frames.push(frame));
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('stream-ready');
    expect(frames[0].id).toEqual(expect.any(String));
    jest.advanceTimersByTime(15000);
    expect(frames[1]).toEqual({
      type: 'heartbeat',
      id: frames[0].id,
      data: { timestamp: new Date().toISOString() },
    });
    expect(frames[1].data).not.toHaveProperty('jobId');
    subscription.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(15000);
    expect(frames).toHaveLength(2);
  });

  it('keeps a resumable job cursor through repeated heartbeats', () => {
    const frames: MessageEvent[] = [];
    const subscription = service
      .getSseStream()
      .subscribe((frame) => frames.push(frame));
    service.publish('first', progress('translating'));
    const jobCursor = frames[1].id;
    jest.advanceTimersByTime(30000);
    expect(frames[2].type).toBe('heartbeat');
    expect(frames[2].id).toBe(jobCursor);
    expect(frames[3].id).toBe(jobCursor);
    subscription.unsubscribe();
    service.publish('first', progress('completed'));
    const resumed: MessageEvent[] = [];
    const reconnect = service
      .getSseStream(frames[3].id)
      .subscribe((frame) => resumed.push(frame));
    expect(resumed[0].data).toMatchObject({
      jobId: 'first',
      phase: 'completed',
    });
    reconnect.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('replays missed terminal events, leaves fresh connections quiet, and does not duplicate acknowledged events', () => {
    const first: MessageEvent[] = [];
    const initial = service
      .getSseStream()
      .subscribe((frame) => first.push(frame));
    const cursor = first[0].id;
    initial.unsubscribe();
    service.publish('missed', progress('completed'));
    const reconnect: MessageEvent[] = [];
    const resumed = service
      .getSseStream(cursor)
      .subscribe((frame) => reconnect.push(frame));
    expect(reconnect[0].id).toEqual(expect.any(String));
    expect(reconnect[0].data).toEqual(
      expect.objectContaining({
        jobId: 'missed',
        phase: 'completed',
        type: 'completed',
      }),
    );
    expect(reconnect[0]).not.toHaveProperty('type');
    expect(reconnect[1].type).toBe('stream-ready');
    resumed.unsubscribe();
    const fresh: MessageEvent[] = [];
    const newConnection = service
      .getSseStream()
      .subscribe((frame) => fresh.push(frame));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].type).toBe('stream-ready');
    newConnection.unsubscribe();
    const afterLast: MessageEvent[] = [];
    const caughtUp = service
      .getSseStream(reconnect[0].id)
      .subscribe((frame) => afterLast.push(frame));
    expect(afterLast).toHaveLength(1);
    expect(afterLast[0].type).toBe('stream-ready');
    caughtUp.unsubscribe();
  });

  it('caps replay at1000, expires after ten minutes, and rejects malformed or foreign cursors', () => {
    let cursor: string | undefined;
    const initial = service.getSseStream().subscribe((frame) => {
      cursor = frame.id;
    });
    initial.unsubscribe();
    for (let index = 0; index < 1100; index += 1)
      service.publish(`job-${index}`, progress('completed'));
    const replay: MessageEvent[] = [];
    const subscription = service
      .getSseStream(cursor)
      .subscribe((frame) => replay.push(frame));
    expect(replay.filter((frame) => !frame.type)).toHaveLength(1000);
    expect(service['replayFrames'].size).toBe(1000);
    subscription.unsubscribe();
    for (const invalidCursor of [
      'different-process:0',
      'nonsense',
      `${cursor}garbage`,
    ]) {
      const frames: MessageEvent[] = [];
      const invalid = service
        .getSseStream(invalidCursor)
        .subscribe((frame) => frames.push(frame));
      expect(frames).toHaveLength(1);
      invalid.unsubscribe();
    }
    jest.advanceTimersByTime(600000);
    const expired: MessageEvent[] = [];
    const reconnect = service
      .getSseStream(cursor)
      .subscribe((frame) => expired.push(frame));
    expect(expired).toHaveLength(1);
    expect(service['replayFrames'].size).toBe(0);
    reconnect.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('completes every active stream and clears heartbeat timers when the module shuts down', () => {
    const firstFrames: MessageEvent[] = [];
    const secondFrames: MessageEvent[] = [];
    const completed: string[] = [];
    const all = service
      .getAllStream()
      .subscribe({ complete: () => completed.push('all') });
    const firstStream = service.getSseStream();
    const secondStream = service.getSseStream();
    const first = firstStream.subscribe({
      next: (frame) => firstFrames.push(frame),
      complete: () => completed.push('first'),
    });
    const second = secondStream.subscribe({
      next: (frame) => secondFrames.push(frame),
      complete: () => completed.push('second'),
    });
    service.publish('active', progress());
    expect(jest.getTimerCount()).toBe(2);
    expect(service['replayFrames'].size).toBe(1);
    service.onModuleDestroy();
    expect(completed).toEqual(['all', 'first', 'second']);
    expect(all.closed).toBe(true);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(service['replayFrames'].size).toBe(0);
    jest.advanceTimersByTime(60000);
    service.publish('after-shutdown', progress('completed'));
    expect(firstFrames).toHaveLength(2);
    expect(secondFrames).toHaveLength(2);
    expect(service['replayFrames'].size).toBe(0);
    service.onModuleDestroy();
    expect(completed).toHaveLength(3);
  });

  it('immediately completes subscriptions created after shutdown without starting heartbeat timers', () => {
    service.onModuleDestroy();
    const frames: MessageEvent[] = [];
    let sseCompleted = false;
    let allCompleted = false;
    const sse = service.getSseStream('old-cursor').subscribe({
      next: (frame) => frames.push(frame),
      complete: () => {
        sseCompleted = true;
      },
    });
    const all = service.getAllStream().subscribe({
      complete: () => {
        allCompleted = true;
      },
    });
    expect(sseCompleted).toBe(true);
    expect(allCompleted).toBe(true);
    expect(sse.closed).toBe(true);
    expect(all.closed).toBe(true);
    expect(frames).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
