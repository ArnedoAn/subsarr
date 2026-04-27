import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { merge, map, Observable, of } from 'rxjs';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';
import { JobsEventsService } from './jobs-events.service';
import { CreateBatchJobsDto } from './dto/create-batch-jobs.dto';
import { BatchPreviewDto } from './dto/batch-preview.dto';
import { LogsQueryDto } from './dto/logs-query.dto';
import { SetJobPriorityDto } from './dto/set-job-priority.dto';

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
  async logs(@Query() query: LogsQueryDto) {
    return this.jobsService.queryLogs(query);
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.jobsService.retryFromArchive(id);
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

  @Sse(':id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    const last = this.jobsEventsService.peekLast(id);
    const live$ = this.jobsEventsService.getStream(id);
    const source$ = last ? merge(of(last), live$) : live$;
    return source$.pipe(
      map((event) => ({
        data: event,
      })),
    );
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.jobsService.getById(id);
  }
}
