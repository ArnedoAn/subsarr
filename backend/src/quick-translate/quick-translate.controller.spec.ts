/// <reference lib="es2024.promise" />
jest.mock('./quick-translate.service', () => ({
  QuickTranslateService: class {},
}));
jest.mock('archiver', () => ({ __esModule: true, default: jest.fn() }));

import { PassThrough, Writable } from 'node:stream';
import type { Response } from 'express';
import archiver from 'archiver';
import { QuickTranslateController } from './quick-translate.controller';
import type { QuickTranslateService } from './quick-translate.service';

class DownloadResponse extends Writable {
  statusCode = 200;
  body: unknown;
  headers: Record<string, string> = {};
  constructor() {
    super({ write: (_chunk, _encoding, callback) => callback() });
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(body: unknown) {
    this.body = body;
    return this;
  }
}

function archiveFixture() {
  const stream = new PassThrough();
  const pending = Promise.withResolvers<void>();
  const archive = Object.assign(stream, {
    abort: jest.fn(),
    append: jest.fn(),
    // Intentionally never settles: this reproduces archiver's aborted queue behavior.
    finalize: jest.fn().mockReturnValue(pending.promise),
  });
  return archive;
}

function controllerFixture() {
  const quick = {
    downloads: jest
      .fn()
      .mockReturnValue([
        { name: 'example.spa.srt', content: Buffer.from('subtitle') },
      ]),
  };
  return new QuickTranslateController(
    quick as unknown as QuickTranslateService,
  );
}

afterEach(() => {
  jest.clearAllMocks();
});

it('releases a disconnected ZIP slot and settles its handler even if finalize never settles', async () => {
  const controller = controllerFixture();
  const firstArchive = archiveFixture();
  const secondArchive = archiveFixture();
  const replacementArchive = archiveFixture();
  jest
    .mocked(archiver)
    .mockReturnValueOnce(firstArchive as unknown as archiver.Archiver)
    .mockReturnValueOnce(secondArchive as unknown as archiver.Archiver)
    .mockReturnValueOnce(replacementArchive as unknown as archiver.Archiver);
  const first = new DownloadResponse();
  const second = new DownloadResponse();
  const firstHandler = controller.zip('batch', first as unknown as Response);
  const secondHandler = controller.zip('batch', second as unknown as Response);
  const rejected = new DownloadResponse();
  await controller.zip('batch', rejected as unknown as Response);
  expect(rejected.statusCode).toBe(503);
  expect(archiver).toHaveBeenCalledTimes(2);

  first.destroy();
  await firstHandler;
  expect(firstArchive.abort).toHaveBeenCalledTimes(1);
  expect(firstArchive.destroyed).toBe(true);
  expect(first.listenerCount('close')).toBe(0);
  expect(first.listenerCount('finish')).toBe(0);
  expect(first.listenerCount('error')).toBe(0);
  expect(firstArchive.listenerCount('error')).toBe(0);

  const replacement = new DownloadResponse();
  const replacementHandler = controller.zip(
    'batch',
    replacement as unknown as Response,
  );
  expect(archiver).toHaveBeenCalledTimes(3);
  second.destroy();
  replacement.destroy();
  await Promise.all([secondHandler, replacementHandler]);
  expect(secondArchive.abort).toHaveBeenCalledTimes(1);
  expect(replacementArchive.abort).toHaveBeenCalledTimes(1);
});

it('releases ZIP slots once on HTTP finish without waiting for archive finalization', async () => {
  const controller = controllerFixture();
  const archive = archiveFixture();
  jest
    .mocked(archiver)
    .mockReturnValueOnce(archive as unknown as archiver.Archiver);
  const response = new DownloadResponse();
  const handler = controller.zip('batch', response as unknown as Response);
  response.end();
  await handler;
  expect(archive.abort).toHaveBeenCalledTimes(1);
  expect(archive.destroyed).toBe(true);
  expect(response.listenerCount('close')).toBe(0);
  expect(response.listenerCount('finish')).toBe(0);
  expect(response.listenerCount('error')).toBe(0);
});

it('destroys a failed archive response and frees the slot without hanging its handler', async () => {
  const controller = controllerFixture();
  const archive = archiveFixture();
  jest
    .mocked(archiver)
    .mockReturnValueOnce(archive as unknown as archiver.Archiver);
  const response = new DownloadResponse();
  const handler = controller.zip('batch', response as unknown as Response);
  archive.emit('error', new Error('archive failed'));
  await handler;
  expect(response.destroyed).toBe(true);
  expect(archive.destroyed).toBe(true);
  expect(archive.abort).toHaveBeenCalledTimes(1);
  expect(archive.listenerCount('error')).toBe(0);
});
