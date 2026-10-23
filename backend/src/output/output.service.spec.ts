import { ConfigService } from '@nestjs/config';
import { OutputService } from './output.service';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const normalizeSeparators = (value: string): string =>
  value.replaceAll('\\', '/');

describe('OutputService', () => {
  let service: OutputService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: Object.assign(jest.fn(), {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'subsync.forceVtt') return false;
          return null;
        }),
      }),
    } as unknown as ConfigService;
    service = new OutputService(configService);
  });

  it('builds jellyfin compatible subtitle path', () => {
    const result = service.buildSubtitlePath(
      '/media/Breaking.Bad.S01E01.mkv',
      'es',
    );
    expect(normalizeSeparators(result)).toBe(
      '/media/Breaking.Bad.S01E01.es.srt',
    );
  });

  it('supports forced subtitle naming', () => {
    const result = service.buildSubtitlePath(
      '/media/The.Matrix.1999.mkv',
      'es',
      true,
    );
    expect(normalizeSeparators(result)).toBe(
      '/media/The.Matrix.1999.es.forced.srt',
    );
  });

  it('builds ASS path when extension is ass', () => {
    const result = service.buildSubtitlePath(
      '/media/Show.S01E01.mkv',
      'spa',
      false,
      'ass',
    );
    expect(normalizeSeparators(result)).toBe('/media/Show.S01E01.spa.ass');
  });

  it('builds forced ASS path', () => {
    const result = service.buildSubtitlePath(
      '/media/Show.S01E01.mkv',
      'spa',
      true,
      'ass',
    );
    expect(normalizeSeparators(result)).toBe(
      '/media/Show.S01E01.spa.forced.ass',
    );
  });

  it('builds alternate second-slot path', () => {
    const result = service.buildSubtitlePath(
      '/media/Show.S01E01.mkv',
      'spa',
      false,
      'ass',
      'alternate',
    );
    expect(normalizeSeparators(result)).toBe('/media/Show.S01E01.spa.2.ass');
  });
});

describe('OutputService atomic publication', () => {
  let root: string;
  let media: string;
  let service: OutputService;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-output-test-'));
    media = path.join(root, 'Movie.mkv');
    await fs.writeFile(media, 'fixture');
    service = new OutputService({
      getOrThrow: () => ({
        mediaDirs: [root],
        dataDir: path.join(root, 'data'),
      }),
    } as unknown as ConfigService);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('never clobbers existing subtitles by default', async () => {
    const destination = await service.writeSubtitle(media, 'spa', 'original');
    await expect(
      service.writeSubtitle(media, 'spa', 'replacement'),
    ).rejects.toThrow('already exists');
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
  });

  it('snapshots an intentional replacement in history before atomic publication', async () => {
    const destination = await service.writeSubtitle(media, 'spa', 'original');
    await service.writeSubtitle(
      media,
      'spa',
      'replacement',
      false,
      'srt',
      'default',
      { overwrite: true, itemId: 'movie-1' },
    );
    const history = await service.listTranslationHistory('movie-1');
    expect(history).toHaveLength(1);
    expect(
      await fs.readFile(
        path.join(root, 'data', 'history', 'movie-1', history[0]),
        'utf8',
      ),
    ).toBe('original');
    expect(await fs.readFile(destination, 'utf8')).toBe('replacement');
  });

  it('leaves original subtitle untouched when already cancelled', async () => {
    const destination = await service.writeSubtitle(media, 'spa', 'original');
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.writeSubtitle(
        media,
        'spa',
        'replacement',
        false,
        'srt',
        'default',
        { overwrite: true, itemId: 'movie-1', signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
  });

  it('rejects language path injection and unsafe history IDs', async () => {
    await expect(
      service.writeSubtitle(media, '../spa', 'unsafe'),
    ).rejects.toThrow('language');
    await expect(service.listTranslationHistory('../escape')).rejects.toThrow(
      'history item',
    );
  });
});
