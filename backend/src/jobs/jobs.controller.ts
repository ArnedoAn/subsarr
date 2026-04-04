import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';
import { JobsEventsService } from './jobs-events.service';
import { CreateBatchJobsDto } from './dto/create-batch-jobs.dto';
import { BatchPreviewDto } from './dto/batch-preview.dto';
import { LogsQueryDto } from './dto/logs-query.dto';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly jobsEventsService: JobsEventsService,
  ) {}

  @Post()
  async enqueue(@Body() dto: CreateJobDto) {
    return this.jobsService.enqueue(dto);
  }

  @Post('batch')
  async enqueueBatch(@Body() dto: CreateBatchJobsDto) {
    return this.jobsService.enqueueBatch(dto);
  }

  @Post('batch/preview')
  async previewBatch(@Body() dto: BatchPreviewDto) {
    return this.jobsService.previewBatch(dto);
  }

  @Get()
  async list() {
    return this.jobsService.list();
  }

  @Get('logs/all')
  logs(@Query() query: LogsQueryDto) {
    return this.jobsService.queryLogs(query);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.jobsService.getById(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.jobsService.cancel(id);
  }

  @Get(':id/logs')
  logsByJob(@Param('id') id: string) {
    return this.jobsService.getLogsByJob(id);
  }

  @Sse(':id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return this.jobsEventsService.getStream(id).pipe(
      map((event) => ({
        data: event,
      })),
    );
  }
}
