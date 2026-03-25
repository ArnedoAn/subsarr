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
});
