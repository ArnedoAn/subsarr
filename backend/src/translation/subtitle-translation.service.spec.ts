jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));
import { SubtitleTranslationService } from './subtitle-translation.service';
import type { TranslationService } from './translation.service';
import type { SettingsService } from '../settings/settings.service';
import type { GlossaryService } from '../glossary/glossary.service';
const mixedDocuments = [
  {
    filename: 'mixed.srt',
    content:
      '\ufeff1\r\n00:00:00,000 --> 00:00:01,000\r\n\r\n7\r\n00:00:02,000 --> 00:00:03,000\r\n<i>Hello</i>\r\n\r\n12\r\n00:00:04,000 --> 00:00:04,000\r\nKeep untouched\r\n',
  },
  {
    filename: 'mixed.ass',
    content:
      '[Events]\r\nFormat: Start, End, Text\r\nDialogue: 0:00:00.00,0:00:01.00,\r\nDialogue: 0:00:02.00,0:00:03.00,<i>Hello</i>\r\nDialogue: 0:00:04.00,0:00:04.00,Keep untouched\r\n',
  },
  {
    filename: 'mixed.vtt',
    content:
      'WEBVTT\r\n\r\nempty-id\r\n00:00.000 --> 00:01.000\r\n\r\ntranslated-id\r\n00:02.000 --> 00:03.000\r\n<i>Hello</i>\r\n\r\nzero-duration-id\r\n00:04.000 --> 00:04.000\r\nKeep untouched\r\n',
  },
] as const;
describe('SubtitleTranslationService', () => {
  const translateLines = jest.fn();
  const settings = {
    getSettings: jest.fn().mockResolvedValue({
      openRouterApiKey: 'saved-open',
      deepSeekApiKey: 'saved-paid',
      translationVerificationEnabled: true,
    }),
  };
  const glossary = {
    formatForPrompt: jest.fn().mockResolvedValue('Saved terminology'),
  };
  const service = new SubtitleTranslationService(
    { translateLines } as unknown as TranslationService,
    settings as unknown as SettingsService,
    glossary as unknown as GlossaryService,
  );
  beforeEach(() => {
    translateLines.mockReset();
  });
  const input = '\ufeff7\r\n00:00:01,000 --> 00:00:02,000\r\n<i>Hello</i>\r\n';
  it('loads saved credentials/glossary and preserves document format, cue IDs and newlines', async () => {
    translateLines.mockResolvedValue({
      lines: ['<i>Hola</i>'],
      warnings: ['Semantic warning'],
      tierUsed: 'free',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const onUsage = jest.fn();
    const signal = new AbortController().signal;
    const result = await service.translateDocument(
      Buffer.from(input),
      'upload.srt',
      { targetLanguage: 'spa', onUsage, signal },
    );
    expect(result).toMatchObject({
      content: input.replace('Hello', 'Hola'),
      extension: 'srt',
      cueCount: 1,
      warnings: ['Semantic warning'],
    });
    expect(translateLines).toHaveBeenCalledWith(
      ['<i>Hello</i>'],
      'spa',
      'saved-open',
      'saved-paid',
      expect.objectContaining({
        glossaryHint: 'Saved terminology',
        verificationEnabled: true,
        subtitleFormat: 'srt',
        onUsage,
        signal,
      }),
    );
  });
  it('sniffs real ASS content even when extraction filename says SRT', () => {
    expect(
      service.inspectDocument(
        '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello',
        'subtitle.srt',
      ),
    ).toEqual({ cueCount: 1, extension: 'ass' });
  });
  it('refuses invalid inputs before provider work', async () => {
    await expect(
      service.translateDocument('invalid', 'bad.srt', {
        targetLanguage: 'spa',
      }),
    ).rejects.toThrow();
    expect(translateLines).not.toHaveBeenCalled();
    expect(() =>
      service.inspectDocument('x'.repeat(8 * 1024 * 1024 + 1), 'large.srt'),
    ).toThrow('8MB');
    const tooMany = Array.from(
      { length: 10001 },
      (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\nHello\n\n`,
    ).join('');
    expect(() => service.inspectDocument(tooMany, 'many.srt')).toThrow('10000');
  });
  it.each(mixedDocuments)(
    'preserves empty and zero-duration blocks verbatim in $filename',
    async ({ filename, content }) => {
      translateLines.mockResolvedValue({
        lines: ['<i>Hola</i>'],
        warnings: [],
        tierUsed: 'free',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });
      expect(service.inspectDocument(content, filename).cueCount).toBe(3);
      const result = await service.translateDocument(content, filename, {
        targetLanguage: 'spa',
      });
      expect(result.content).toBe(content.replace('Hello', 'Hola'));
      expect(result.cueCount).toBe(3);
      expect(translateLines).toHaveBeenCalledWith(
        ['<i>Hello</i>'],
        'spa',
        'saved-open',
        'saved-paid',
        expect.objectContaining({ targetLanguage: 'spa' }),
      );
    },
  );
  it.each(mixedDocuments)(
    'rejects empty-only $filename before provider work',
    async ({ filename, content }) => {
      await expect(
        service.translateDocument(
          content.replace('<i>Hello</i>', ''),
          filename,
          { targetLanguage: 'spa' },
        ),
      ).rejects.toThrow('no translatable cues');
      expect(translateLines).not.toHaveBeenCalled();
    },
  );
  it('counts preserved blocks towards the document cue limit', () => {
    const source = Array.from(
      { length: 10001 },
      (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:01,000\nKept\n\n`,
    ).join('');
    expect(() => service.inspectDocument(source, 'many.srt')).toThrow('10000');
    expect(translateLines).not.toHaveBeenCalled();
  });
  it('rejects lost markup independently of the provider engine', async () => {
    translateLines.mockResolvedValue({
      lines: ['Hola'],
      warnings: [],
      tierUsed: 'free',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    await expect(
      service.translateDocument(input, 'upload.srt', { targetLanguage: 'spa' }),
    ).rejects.toThrow('markup');
  });
});
