import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { JobsService } from './jobs/jobs.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly jobsService: JobsService,
  ) {}

  @Get()
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('health')
  async getHealthDetailed() {
    const basic = this.appService.getHealth();
    const queue = await this.jobsService.getQueueHealth();
    const m = process.memoryUsage();
    return {
      ...basic,
      queue,
      memory: {
        heapUsed: m.heapUsed,
        heapTotal: m.heapTotal,
        rss: m.rss,
      },
    };
  }
}
