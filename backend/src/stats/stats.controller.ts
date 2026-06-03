import { Controller, Get, Header } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @Header('Cache-Control', 'private, max-age=30')
  async getStats() {
    return this.statsService.getDashboardStats();
  }
}
