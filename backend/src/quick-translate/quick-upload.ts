import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Readable } from 'node:stream';
import { finalize } from 'rxjs';
import { QUICK_LIMITS } from './quick-translate.internal';

@Injectable()
export class QuickUploadAdmission implements NestInterceptor {
  private active = 0;
  intercept(context: ExecutionContext, next: CallHandler) {
    if (this.active >= 2)
      throw new ServiceUnavailableException(
        'Two subtitle uploads are already in progress',
      );
    this.active++;
    const request = context.switchToHttp().getRequest<Request>();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
    request.once('aborted', release);
    return next.handle().pipe(
      finalize(() => {
        request.off('aborted', release);
        release();
      }),
    );
  }
}

const uploadBytes = Symbol('quickUploadBytes');
type UploadRequest = Request & { [uploadBytes]?: number };
export const quickMemoryStorage = {
  _handleFile(
    req: UploadRequest,
    file: { stream: Readable },
    callback: (
      error?: Error | null,
      info?: { buffer: Buffer; size: number },
    ) => void,
  ) {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const abort = () => {
      if (!failed) {
        failed = true;
        chunks.length = 0;
        callback(new BadRequestException('Upload interrupted'));
      }
    };
    req.once('aborted', abort);
    file.stream.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      req[uploadBytes] = (req[uploadBytes] ?? 0) + chunk.length;
      if (req[uploadBytes] > QUICK_LIMITS.batchBytes) {
        failed = true;
        chunks.length = 0;
        req.off('aborted', abort);
        callback(new BadRequestException('Total upload exceeds 20 MB'));
        return;
      }
      chunks.push(chunk);
    });
    file.stream.once('error', (error) => {
      req.off('aborted', abort);
      if (!failed) {
        failed = true;
        chunks.length = 0;
        callback(error);
      }
    });
    file.stream.once('end', () => {
      req.off('aborted', abort);
      if (!failed)
        callback(null, { buffer: Buffer.concat(chunks, size), size });
    });
  },
  _removeFile(
    _req: Request,
    file: { buffer?: Buffer },
    callback: (error: Error | null) => void,
  ) {
    delete file.buffer;
    callback(null);
  },
};
