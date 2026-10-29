jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));
import { SubtitleTranslationService } from './subtitle-translation.service';
import type { TranslationService } from './translation.service';
import type { SettingsService } from '../settings/settings.service';
import type { GlossaryService } from '../glossary/glossary.service';
import type { WorkspacePersistenceService } from '../translation-workspace/workspace-persistence.service';
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
      openRouterModel: 'saved/openrouter:free',
      deepSeekModel: 'saved/deepseek',
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
        provider: 'openrouter',
        model: 'saved/openrouter:free',
        sessionId: expect.stringMatching(
          /^[0-9a-f-]{36}$/,
        ) as unknown as string,
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
  it('preserves an explicit provider/model/session snapshot across document orchestration', async () => {
    translateLines.mockResolvedValue({
      lines: ['<i>Hola</i>'],
      warnings: [],
      tierUsed: 'subscription',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const sessionId = '594ffef6-d163-4a35-9610-1e571a18d448';
    await service.translateDocument(input, 'upload.srt', {
      targetLanguage: 'spa',
      provider: 'opencode-go',
      model: 'glm-5.2',
      sessionId,
    });
    expect(translateLines).toHaveBeenCalledWith(
      ['<i>Hello</i>'],
      'spa',
      'saved-open',
      'saved-paid',
      expect.objectContaining({
        provider: 'opencode-go',
        model: 'glm-5.2',
        sessionId,
      }),
    );
  });
  it('resumes validated checkpoint chunks without paid translation or automatic memory saves', async () => {
    const translations: Record<number, string> = {};
    const persistence = {
      open: jest.fn(() =>
        Promise.resolve({
          key: 'checkpoint',
          translations: { ...translations },
          contextSheet: null,
        }),
      ),
      saveChunk: jest.fn((_key: string, indices: number[], lines: string[]) => {
        indices.forEach((index, position) => {
          translations[index] = lines[position];
        });
        return Promise.resolve();
      }),
      approve: jest.fn(),
    };
    const resumed = new SubtitleTranslationService(
      { translateLines } as unknown as TranslationService,
      settings as unknown as SettingsService,
      glossary as unknown as GlossaryService,
      persistence as unknown as WorkspacePersistenceService,
    );
    const paid = jest.fn();
    translateLines.mockImplementation(
      async (
        sources: string[],
        _language: string,
        _open: string,
        _deep: string,
        options: {
          initialTranslations: Record<number, string>;
          onChunkTranslated?: (info: {
            indices: number[];
            lines: string[];
          }) => Promise<void>;
        },
      ) => {
        const lines = sources.map((_source, index) => {
          if (options.initialTranslations[index])
            return options.initialTranslations[index];
          paid();
          return '<i>Hola</i>';
        });
        await options.onChunkTranslated?.({ indices: [0], lines });
        return {
          lines,
          warnings: [],
          tierUsed: 'paid',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      },
    );
    await resumed.translateDocument(input, 'resume.srt', {
      targetLanguage: 'spa',
    });
    const result = await resumed.translateDocument(input, 'resume.srt', {
      targetLanguage: 'spa',
    });
    expect(paid).toHaveBeenCalledTimes(1);
    expect(result.checkpointReusedCues).toBe(1);
    expect(persistence.approve).not.toHaveBeenCalled();
  });
  it('never opens or writes checkpoints for ephemeral translation', async () => {
    const persistence = {
      open: jest.fn(),
      saveChunk: jest.fn(),
      saveContext: jest.fn(),
    };
    const ephemeral = new SubtitleTranslationService(
      { translateLines } as unknown as TranslationService,
      settings as unknown as SettingsService,
      glossary as unknown as GlossaryService,
      persistence as unknown as WorkspacePersistenceService,
    );
    translateLines.mockResolvedValue({
      lines: ['<i>Hola</i>'],
      warnings: [],
      tierUsed: 'free',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    await ephemeral.translateDocument(input, 'quick.srt', {
      targetLanguage: 'spa',
      persistence: 'ephemeral',
    });
    expect(persistence.open).not.toHaveBeenCalled();
    expect(persistence.saveChunk).not.toHaveBeenCalled();
    expect(persistence.saveContext).not.toHaveBeenCalled();
  });
  it('reuses approved memory only when it fits the engine line structure', async () => {
    const persistence = {
      open: jest.fn(),
      lookup: jest.fn(({ source }: { source: string }) =>
        Promise.resolve(
          source === 'Hello'
            ? { target: 'Hola,\nqué tal' }
            : { target: 'Adiós' },
        ),
      ),
    };
    const withMemory = new SubtitleTranslationService(
      { translateLines } as unknown as TranslationService,
      settings as unknown as SettingsService,
      glossary as unknown as GlossaryService,
      persistence as unknown as WorkspacePersistenceService,
    );
    translateLines.mockResolvedValue({
      lines: ['Hola', 'Adiós'],
      warnings: [],
      tierUsed: 'free',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    const result = await withMemory.translateDocument(
      '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nGoodbye\n',
      'memory.srt',
      {
        targetLanguage: 'spa',
        persistence: 'ephemeral',
        useTranslationMemory: true,
      },
    );
    const [, , , , options] = translateLines.mock.calls[0] as [
      string[],
      string,
      string,
      string,
      { initialTranslations?: Record<number, string> },
    ];
    expect(options.initialTranslations).toEqual({ 1: 'Adiós' });
    expect(result.memoryReusedCues).toBe(1);
  });
  it('generates balanced context once, reuses it, and accounts its tokens', async () => {
    const persistence = {
      open: jest
        .fn()
        .mockResolvedValue({ key: 'c', translations: {}, contextSheet: null }),
      saveContext: jest.fn(),
      saveChunk: jest.fn(),
    };
    const balanced = new SubtitleTranslationService(
      { translateLines } as unknown as TranslationService,
      settings as unknown as SettingsService,
      glossary as unknown as GlossaryService,
      persistence as unknown as WorkspacePersistenceService,
    );
    translateLines.mockImplementation(
      (
        _lines: string[],
        _language: string,
        _open: string,
        _deep: string,
        options: { task?: string },
      ) =>
        Promise.resolve({
          lines:
            options.task === 'context'
              ? ['Two friends meet.']
              : ['<i>Hola</i>'],
          warnings: [],
          tierUsed: 'paid',
          usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
        }),
    );
    const result = await balanced.translateDocument(input, 'balanced.srt', {
      targetLanguage: 'spa',
      qualityMode: 'balanced',
    });
    expect(result.usage.totalTokens).toBe(10);
    expect(persistence.saveContext).toHaveBeenCalledWith(
      'c',
      'Two friends meet.',
    );
    persistence.open.mockResolvedValue({
      key: 'c',
      translations: {},
      contextSheet: 'Two friends meet.',
    });
    translateLines.mockClear();
    await balanced.translateDocument(input, 'balanced.srt', {
      targetLanguage: 'spa',
      qualityMode: 'balanced',
    });
    expect(translateLines).toHaveBeenCalledTimes(1);
  });
  it('reviews at most 100 suspect source cues in batches of at most 60 and accounts every pass', async () => {
    const source = Array.from(
      { length: 101 },
      (_, index) => `${index + 1}\n00:00:01,000 --> 00:00:01,499\nHello\n\n`,
    ).join('');
    translateLines.mockImplementation(
      (
        lines: string[],
        _language: string,
        _open: string,
        _deep: string,
        options: { task?: string },
      ) =>
        Promise.resolve({
          lines:
            options.task === 'context'
              ? ['Friends meet.']
              : lines.map(() => 'Hola'),
          warnings: [],
          tierUsed: 'paid',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }),
    );
    const result = await service.translateDocument(source, 'review.srt', {
      targetLanguage: 'spa',
      qualityMode: 'review',
      persistence: 'ephemeral',
    });
    // Jest's untyped mock records this known in-process engine signature.
    const calls = translateLines.mock.calls as Parameters<
      TranslationService['translateLines']
    >[];
    const reviews = calls.filter((call) => call[4]?.task === 'review');
    expect(reviews.map((call) => call[0].length)).toEqual([60, 40]);
    expect(reviews[0][0][0]).toBe('Hello');
    expect(reviews[0][4]?.contextHint).toContain('Hola');
    expect(result.usage.totalTokens).toBe(8);
  });
});
