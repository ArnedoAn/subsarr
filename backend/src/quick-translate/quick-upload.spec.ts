/// <reference lib="es2024.promise" />
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Request } from 'express';
import { Subject } from 'rxjs';
import { QuickUploadAdmission, quickMemoryStorage } from './quick-upload';
import { QUICK_LIMITS } from './quick-translate.internal';

async function flush() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

it('bounds aggregate upload bytes before accepting a batch into memory', async () => {
  const request = new EventEmitter() as Request;
  for (let index = 0; index < 10; index++) {
    const stream = new PassThrough();
    const callback = jest.fn<
      void,
      [error?: Error | null, info?: { buffer: Buffer; size: number }]
    >();
    quickMemoryStorage._handleFile(request, { stream }, callback);
    stream.end(Buffer.alloc(QUICK_LIMITS.fileBytes));
    await flush();
    expect(callback).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ size: QUICK_LIMITS.fileBytes }),
    );
  }
  const stream = new PassThrough();
  const callback = jest.fn<
    void,
    [error?: Error | null, info?: { buffer: Buffer; size: number }]
  >();
  quickMemoryStorage._handleFile(request, { stream }, callback);
  stream.end(Buffer.from('x'));
  await flush();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
});

it('discards partial upload chunks and calls completion once when the browser aborts', async () => {
  const request = new EventEmitter() as Request;
  const stream = new PassThrough();
  const callback = jest.fn<
    void,
    [error?: Error | null, info?: { buffer: Buffer; size: number }]
  >();
  quickMemoryStorage._handleFile(request, { stream }, callback);
  stream.write(Buffer.from('partial'));
  request.emit('aborted');
  stream.end();
  await flush();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
  expect(request.listenerCount('aborted')).toBe(0);
});

it('admits at most two uploads and releases aborted requests without double release', () => {
  const admission = new QuickUploadAdmission();
  const request = new EventEmitter() as Request;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const subject = new Subject<void>();
  const next: CallHandler = { handle: () => subject };
  const first = admission.intercept(context, next).subscribe();
  const second = admission.intercept(context, next).subscribe();
  expect(() => admission.intercept(context, next)).toThrow(
    ServiceUnavailableException,
  );
  request.emit('aborted');
  first.unsubscribe();
  second.unsubscribe();
  const third = admission.intercept(context, next).subscribe();
  const fourth = admission.intercept(context, next).subscribe();
  expect(() => admission.intercept(context, next)).toThrow(
    ServiceUnavailableException,
  );
  third.unsubscribe();
  fourth.unsubscribe();
  expect(request.listenerCount('aborted')).toBe(0);
});
