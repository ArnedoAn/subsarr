import { RulesService } from './rules.service';
import { type MediaItem } from '../library/media-item.entity';
import { type SettingsService } from '../settings/settings.service';

const baseItem: MediaItem = {
  id: '1',
  path: '/media/movies/The.Matrix.1999.mkv',
  name: 'The.Matrix.1999',
  type: 'movie',
  subtitleTracks: [
    { index: 2, language: 'eng', codec: 'subrip' },
    { index: 3, language: 'spa', codec: 'subrip' },
  ],
  externalSubtitles: [],
  size: 10,
  lastModified: new Date(),
};

describe('RulesService', () => {
  const mockSettingsService: Pick<SettingsService, 'getSettings'> = {
    getSettings: jest.fn(() =>
      Promise.resolve({
        mediaDirs: ['/media'],
        sourceLanguage: 'eng',
        targetLanguage: 'spa',
        openRouterApiKey: 'x',
        deepSeekApiKey: 'y',
        openRouterModel: 'openrouter/free',
        deepSeekModel: 'deepseek-chat',
        scanCacheTtlMinutes: 30,
        concurrency: 2,
        pathContainsExclusions: ['/ignore/'],
        fileTooLargeBytes: 100,
        translationVerificationEnabled: true,
        rules: [
          { id: 'already-has-target-subtitle', enabled: true },
          { id: 'already-has-external-subtitle', enabled: true },
          { id: 'no-source-track', enabled: true },
          { id: 'image-based-subtitle', enabled: true },
          { id: 'file-too-large', enabled: true },
          { id: 'path-contains', enabled: true },
        ],
        autoScanEnabled: false,
        autoScanCronExpression: '0 */6 * * *',
        autoTranslateNewItems: false,
        telegramEnabled: false,
        telegramEvents: [],
      }),
    ),
  };

  it('skips when embedded target subtitle exists', async () => {
    const service = new RulesService(mockSettingsService as SettingsService);
    const result = await service.evaluate(baseItem);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('Embedded target subtitle');
  });

  it('detects missing source subtitle track', async () => {
    const service = new RulesService(mockSettingsService as SettingsService);
    const result = await service.evaluate(
      {
        ...baseItem,
        subtitleTracks: [{ index: 6, language: 'spa', codec: 'subrip' }],
      },
      { sourceLanguage: 'eng', targetLanguage: 'ita' },
    );

    expect(result.skip).toBe(true);
    expect(result.reason).toContain('No source subtitle track');
  });

  it('skips image-based source tracks', async () => {
    const service = new RulesService(mockSettingsService as SettingsService);
    const result = await service.evaluate(
      {
        ...baseItem,
        subtitleTracks: [
          { index: 6, language: 'eng', codec: 'hdmv_pgs_subtitle' },
        ],
      },
      { targetLanguage: 'ita' },
    );

    expect(result.skip).toBe(true);
    expect(result.reason).toContain('image-based');
  });

  it('skips files over configured size limit', async () => {
    const service = new RulesService(mockSettingsService as SettingsService);
    const result = await service.evaluate(
      {
        ...baseItem,
        size: 999,
        subtitleTracks: [{ index: 6, language: 'eng', codec: 'subrip' }],
      },
      { targetLanguage: 'ita' },
    );

    expect(result.skip).toBe(true);
    expect(result.reason).toContain('size limit');
  });
});
