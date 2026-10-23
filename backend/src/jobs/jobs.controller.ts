import {
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';
import { JobsEventsService } from './jobs-events.service';
import { CreateBatchJobsDto } from './dto/create-batch-jobs.dto';
import { BatchPreviewDto } from './dto/batch-preview.dto';
import { LogsQueryDto } from './dto/logs-query.dto';
import { SetJobPriorityDto } from './dto/set-job-priority.dto';
import { JobsQueryDto } from './dto/jobs-query.dto';
import { RetryJobDto } from './dto/retry-job.dto';

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
  async list(@Query() query: JobsQueryDto) {
    return this.jobsService.list(query);
  }

  @Get('logs/all')
  async logs(@Query() query: LogsQueryDto) {
    return this.jobsService.queryLogs(query);
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string, @Body() body: RetryJobDto) {
    return this.jobsService.retryFromArchive(id, body);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.jobsService.cancel(id);
  }

  @Patch(':id/priority')
  async setPriority(@Param('id') id: string, @Body() body: SetJobPriorityDto) {
    return this.jobsService.setJobPriority(id, body.priority);
  }

  @Get(':id/logs')
  async logsByJob(@Param('id') id: string) {
    return this.jobsService.getLogsByJob(id);
  }

  @Sse('stream')
  stream(
    @Headers('last-event-id') lastEventId?: string,
    @Query('lastEventId') resumeCursor?: string,
  ): Observable<MessageEvent> {
    return this.jobsEventsService.getSseStream(lastEventId || resumeCursor);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.jobsService.getById(id);
  }
}
