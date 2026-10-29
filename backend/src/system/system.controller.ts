import { Controller, Get, Query } from '@nestjs/common';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('preflight')
  preflight() {
    return this.systemService.preflight();
  }

  @Get('directory')
  async listDirectory(@Query('path') dirPath?: string) {
    return this.systemService.listDirectory(dirPath);
  }
}
