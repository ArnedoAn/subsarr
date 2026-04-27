import { ConfigService } from '@nestjs/config';
import { OutputService } from './output.service';

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
