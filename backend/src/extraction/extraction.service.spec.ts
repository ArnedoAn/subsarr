import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExtractionService } from './extraction.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
const mockedSpawn = jest.mocked(spawn);

describe('ExtractionService process safety', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  it('bounds previews and permits local files only with safe argv', async () => {
    let argv: string[] = [];
    mockedSpawn.mockImplementation((...parameters: unknown[]) => {
      argv = parameters[1] as string[];
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: jest.Mock;
      };
      child.stderr = new EventEmitter();
      child.kill = jest.fn();
      void fs
        .writeFile(argv[argv.length - 1], 'subtitle fixture')
        .then(() => child.emit('close', 0));
      return child as unknown as ChildProcess;
    });
    const result = await new ExtractionService().extractSubtitleTrack(
      path.join(os.tmpdir(), '-input.mkv'),
      2,
      'srt',
      { preview: true },
    );
    try {
      expect(argv).toEqual(
        expect.arrayContaining([
          '-nostdin',
          '-protocol_whitelist',
          'file',
          '-map',
          '0:2',
          '-t',
          '120',
          '-fs',
          '1048576',
        ]),
      );
      expect(result.sizeBytes).toBeGreaterThan(0);
    } finally {
      await fs.rm(result.tempFilePath, { force: true });
    }
  });

  it('kills extraction and rejects on cancellation rather than publishing partial output', async () => {
    const controller = new AbortController();
    let killed = false;
    mockedSpawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: jest.Mock;
      };
      child.stderr = new EventEmitter();
      child.kill = jest.fn(() => {
        killed = true;
        setImmediate(() => child.emit('close', null));
        return true;
      });
      setImmediate(() => controller.abort());
      return child as unknown as ChildProcess;
    });
    await expect(
      new ExtractionService().extractSubtitleTrack(
        path.join(os.tmpdir(), 'input.mkv'),
        0,
        'srt',
        { signal: controller.signal },
      ),
    ).rejects.toThrow('cancelled');
    expect(killed).toBe(true);
  });

  it('rejects remote input, malformed stream indices, and pre-cancelled work before spawning', async () => {
    const service = new ExtractionService();
    await expect(
      service.extractSubtitleTrack('https://example.invalid/media.mkv', 0),
    ).rejects.toThrow('local');
    await expect(
      service.extractSubtitleTrack(path.join(os.tmpdir(), 'input.mkv'), -1),
    ).rejects.toThrow('index');
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.extractSubtitleTrack(
        path.join(os.tmpdir(), 'input.mkv'),
        0,
        'srt',
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
});
