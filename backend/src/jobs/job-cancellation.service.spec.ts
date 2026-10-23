import { Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import {
  JobCancellationService,
  JobInterruptionError,
} from './job-cancellation.service';

describe('JobCancellationService', () => {
  const fixture = () => {
    const flags = new Map<string, string>();
    const jobs = new Set<string>();
    const client = {
      set: jest.fn((key: string, value: string) => {
        flags.set(key, value);
        return Promise.resolve('OK');
      }),
      exists: jest.fn((key: string) => Promise.resolve(flags.has(key) ? 1 : 0)),
      get: jest.fn((key: string) => Promise.resolve(flags.get(key) ?? null)),
      eval: jest.fn(
        (_script: string, _keys: number, jobKey: string, flagKey: string) => {
          if (jobs.has(jobKey)) return Promise.resolve(0);
          return Promise.resolve(flags.delete(flagKey) ? 1 : 0);
        },
      ),
    };
    const queue = {
      client,
      toKey: (key: string) => `translation:${key}`,
    } as unknown as Queue;
    return { service: new JobCancellationService(queue), client, flags, jobs };
  };
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('aborts local work with explicit user reason and persists it for other processes', async () => {
    const { service, client } = fixture();
    const control = await service.start('job');
    try {
      await service.request('job');
      const reason: unknown = control.signal.reason;
      expect(reason).toBeInstanceOf(JobInterruptionError);
      if (!(reason instanceof JobInterruptionError)) {
        throw new Error('Expected a job interruption reason');
      }
      expect(reason.reason).toBe('user');
      expect(client.set).toHaveBeenCalledWith(
        'translation:cancel:job',
        'user',
        'EX',
        604800,
      );
      await expect(control.checkpoint()).rejects.toThrow(
        'Job cancelled by user',
      );
    } finally {
      control.stop();
    }
  });
  it('preserves stalled/restart interruption instead of labelling it user cancellation', async () => {
    const { service } = fixture();
    await service.request('stalled', 'stalled');
    const start = service.start('stalled');
    await expect(start).rejects.toMatchObject({
      reason: 'stalled',
    });
    await expect(start).rejects.toThrow('server restarted');
  });
  it('observes remote cancellation during an API call', async () => {
    jest.useFakeTimers();
    const { service, flags } = fixture();
    const control = await service.start('remote');
    try {
      flags.set('translation:cancel:remote', 'user');
      await jest.advanceTimersByTimeAsync(250);
      expect(control.signal.aborted).toBe(true);
    } finally {
      control.stop();
    }
    expect(jest.getTimerCount()).toBe(0);
  });
  it('logs a polling outage without manufacturing user cancellation, then recovers', async () => {
    jest.useFakeTimers();
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, client, flags } = fixture();
    const control = await service.start('outage');
    try {
      client.get.mockRejectedValueOnce(new Error('Redis unavailable'));
      await jest.advanceTimersByTimeAsync(250);
      expect(control.signal.aborted).toBe(false);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('Redis unavailable'),
      );
      flags.set('translation:cancel:outage', 'user');
      await jest.advanceTimersByTimeAsync(250);
      expect(control.signal.reason).toMatchObject({ reason: 'user' });
    } finally {
      control.stop();
    }
  });
  it('clears old cancellation only while the attempt has no Bull job hash', async () => {
    const { service, jobs, flags } = fixture();
    await service.request('old');
    await service.clear('old');
    expect(flags.has('translation:cancel:old')).toBe(false);
    await service.request('active');
    jobs.add('translation:active');
    await service.clear('active');
    expect(flags.get('translation:cancel:active')).toBe('user');
  });
});
