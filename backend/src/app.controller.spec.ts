import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JobsService } from './jobs/jobs.service';

describe('AppController readiness', () => {
  const getQueueHealth = jest.fn();
  let controller: AppController;

  beforeEach(async () => {
    getQueueHealth.mockReset();
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: JobsService, useValue: { getQueueHealth } },
      ],
    }).compile();
    controller = module.get(AppController);
  });

  it('reports live queue readiness and process memory', async () => {
    getQueueHealth.mockResolvedValue({ ok: true, jobCounts: { waiting: 3 } });
    const health = await controller.getHealthDetailed();
    expect(getQueueHealth).toHaveBeenCalledTimes(1);
    expect(health.queue.jobCounts?.waiting).toBe(3);
    expect(health.memory.rss).toBeGreaterThan(0);
  });

  it('returns unavailable when the queue cannot be reached', async () => {
    getQueueHealth.mockResolvedValue({ ok: false, error: 'Redis offline' });
    await expect(controller.getHealthDetailed()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
