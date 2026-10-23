import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Res,
  Sse,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import archiver from 'archiver';
import { finished } from 'node:stream/promises';
import { Observable } from 'rxjs';
import { QuickTranslateService } from './quick-translate.service';
import { QuickRetryDto, QuickTranslateDto } from './quick-translate.dto';
import { QUICK_LIMITS, QuickUpload } from './quick-translate.internal';
import { QuickUploadAdmission, quickMemoryStorage } from './quick-upload';

@Controller('quick-translate')
export class QuickTranslateController {
  private zipDownloads = 0;
  constructor(private readonly quick: QuickTranslateService) {}

  @Post()
  @UseInterceptors(
    QuickUploadAdmission,
    FilesInterceptor('files', QUICK_LIMITS.files, {
      storage: quickMemoryStorage,
      limits: {
        fileSize: QUICK_LIMITS.fileBytes,
        files: QUICK_LIMITS.files,
        fields: 7,
        fieldSize: 256,
        parts: 27,
      },
    }),
  )
  create(
    @UploadedFiles() files: QuickUpload[],
    @Body() dto: QuickTranslateDto,
  ) {
    const { requestId, ...options } = dto;
    return this.quick.create(files, options, requestId);
  }
  @Get('requests/:requestId') requestSnapshot(
    @Param('requestId') requestId: string,
  ) {
    return this.quick.requestSnapshot(requestId);
  }

  @Get(':id') snapshot(@Param('id') id: string) {
    return this.quick.snapshot(id);
  }
  @Post(':id/cancel') cancel(@Param('id') id: string) {
    return this.quick.cancel(id);
  }
  @Post(':id/files/:fileId/cancel') cancelFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.quick.cancel(id, fileId);
  }
  @Post(':id/retry') retry(
    @Param('id') id: string,
    @Body() dto: QuickRetryDto,
  ) {
    return this.quick.retry(id, dto.allowBudgetOverride);
  }

  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    // Every connection receives a complete current snapshot. Event IDs monotonically
    // increase; reconnect never depends on an unbounded replay buffer.
    const changes = this.quick.changes(id);
    return new Observable<MessageEvent>((subscriber) => {
      const send = () => {
        try {
          const snapshot = this.quick.snapshot(id);
          subscriber.next({
            id: String(snapshot.revision),
            type: 'snapshot',
            data: snapshot,
          });
        } catch (error) {
          subscriber.error(error);
        }
      };
      const subscription = changes.subscribe({
        next: send,
        complete: () => subscriber.complete(),
      });
      send();
      const heartbeat = setInterval(
        () => subscriber.next({ type: 'heartbeat', data: { at: Date.now() } }),
        15_000,
      );
      heartbeat.unref();
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }

  @Get(':id/files/:fileId/download')
  download(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res() response: Response,
  ): void {
    const file = this.quick.download(id, fileId);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="subtitle"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    response.send(file.content);
  }

  @Get(':id/download')
  async zip(@Param('id') id: string, @Res() response: Response): Promise<void> {
    if (this.zipDownloads >= 2) {
      response
        .status(503)
        .json({ message: 'Two ZIP downloads already in progress' });
      return;
    }
    const files = this.quick.downloads(id);
    const archive = archiver('zip', { zlib: { level: 3 } });
    this.zipDownloads++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.zipDownloads--;
      response.off('close', release);
      response.off('finish', release);
      response.off('error', fail);
      archive.off('error', fail);
      archive.unpipe(response);
      archive.abort();
      archive.destroy();
    };
    const fail = (error: unknown) => {
      if (released) return;
      release();
      if (!response.destroyed)
        response.destroy(error instanceof Error ? error : undefined);
    };
    response.once('close', release);
    response.once('finish', release);
    response.once('error', fail);
    archive.on('error', fail);
    // Await the HTTP stream, not finalize(): archiver may leave its promise pending
    // when an aborted download stops an in-progress archive queue.
    const completion = finished(response, { cleanup: true }).catch(fail);
    try {
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader(
        'Content-Disposition',
        'attachment; filename="subsarr-translations.zip"',
      );
      archive.pipe(response);
      for (const file of files)
        archive.append(file.content, { name: file.name });
      void archive.finalize().catch(fail);
    } catch (error) {
      fail(error);
    } finally {
      await completion;
      release();
    }
  }
}
