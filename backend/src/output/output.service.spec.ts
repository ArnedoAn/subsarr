import { OutputService } from './output.service';

const normalizeSeparators = (value: string): string =>
  value.replaceAll('\\', '/');

describe('OutputService', () => {
  it('builds jellyfin compatible subtitle path', () => {
    const service = new OutputService();
    const result = service.buildSubtitlePath(
      '/media/Breaking.Bad.S01E01.mkv',
      'es',
    );
    expect(normalizeSeparators(result)).toBe(
      '/media/Breaking.Bad.S01E01.es.srt',
    );
  });

  it('supports forced subtitle naming', () => {
    const service = new OutputService();
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
    const service = new OutputService();
    const result = service.buildSubtitlePath(
      '/media/Show.S01E01.mkv',
      'spa',
      false,
      'ass',
    );
    expect(normalizeSeparators(result)).toBe('/media/Show.S01E01.spa.ass');
  });

  it('builds forced ASS path', () => {
    const service = new OutputService();
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
    const service = new OutputService();
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
