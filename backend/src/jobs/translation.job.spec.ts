jest.mock('../settings/settings.service', () => ({
  SettingsService: class {},
}));
jest.mock('../settings/token-usage.service', () => ({
  TokenUsageService: class {},
}));
jest.mock('../library/library.service', () => ({ LibraryService: class {} }));
jest.mock('../rules/rules.service', () => ({ RulesService: class {} }));
jest.mock('../output/output.service', () => ({ OutputService: class {} }));
jest.mock('../extraction/extraction.service', () => ({
  ExtractionService: class {},
}));
jest.mock('../translation/subtitle-translation.service', () => ({
  SubtitleTranslationService: class {},
}));
jest.mock('../notifications/telegram.service', () => ({
  TelegramService: class {},
}));
jest.mock('../integrations/jellyfin.service', () => ({
  JellyfinService: class {},
}));
jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof NodeFs>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest
        .fn<Promise<Buffer>, [string, { signal: AbortSignal }]>()
        .mockResolvedValue(Buffer.from('subtitle')),
      unlink: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    },
  };
});

import type { Job } from 'bull';
import type * as NodeFs from 'node:fs';
import { promises as fs } from 'node:fs';
import { TranslationJobProcessor } from './translation.job';
import type { JobProgressEvent, TranslationJobPayload } from './jobs.types';
import type {
  DocumentTranslationResult,
  SubtitleTranslationService,
} from '../translation/subtitle-translation.service';
import type {
  ExtractionResult,
  ExtractionService,
} from '../extraction/extraction.service';
import type { OutputService } from '../output/output.service';
import type { ProviderUsage } from '../translation/translation.service';
import type { ArchivedJobSnapshot } from './job-archive.service';
import { JobInterruptionError } from './job-cancellation.service';

function fixture() {
  const controller = new AbortController();
  const control = {
    signal: controller.signal,
    checkpoint: jest.fn<Promise<void>, []>(() => {
      try {
        controller.signal.throwIfAborted();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }),
    stop: jest.fn(),
  };
  const extraction = {
    extractSubtitleTrack: jest
      .fn<
        Promise<ExtractionResult>,
        Parameters<ExtractionService['extractSubtitleTrack']>
      >()
      .mockResolvedValue({
        tempFilePath: '/temporary/subtitle.srt',
        sizeBytes: 8,
      }),
  };
  const translationResult: DocumentTranslationResult = {
    content: 'translated',
    extension: 'srt',
    cueCount: 1,
    warnings: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    tierUsed: 'paid',
  };
  const translate = {
    translateDocument: jest
      .fn<
        Promise<DocumentTranslationResult>,
        Parameters<SubtitleTranslationService['translateDocument']>
      >()
      .mockResolvedValue(translationResult),
  };
  const output = {
    writeSubtitle: jest
      .fn<Promise<string>, Parameters<OutputService['writeSubtitle']>>()
      .mockResolvedValue('/media/title.spa.srt'),
  };
  const usage = {
    addProviderUsage: jest
      .fn<Promise<void>, [ProviderUsage]>()
      .mockResolvedValue(undefined),
  };
  const archive = {
    appendSnapshot: jest
      .fn<Promise<void>, [ArchivedJobSnapshot]>()
      .mockResolvedValue(undefined),
  };
  const events = {
    publish: jest.fn<void, [string, JobProgressEvent]>(),
    complete: jest.fn(),
  };
  const cancellation = {
    start: jest.fn().mockResolvedValue(control),
    isRequested: jest.fn().mockResolvedValue(false),
  };
  const processor = Reflect.construct(TranslationJobProcessor, [
    extraction,
    {
      getById: jest
        .fn()
        .mockResolvedValue({ id: 'media', path: '/media/title.mkv' }),
    },
    { evaluate: jest.fn().mockResolvedValue({ skip: false }) },
    { assertTranslationBudget: jest.fn() },
    translate,
    output,
    events,
    usage,
    { append: jest.fn() },
    archive,
    { notifyJobCompleted: jest.fn(), notifyJobFailed: jest.fn() },
    { refreshLibraryAfterSubtitle: jest.fn() },
    cancellation,
  ]) as TranslationJobProcessor;
  const progress = jest
    .fn<Promise<void>, [number]>()
    .mockResolvedValue(undefined);
  const discard = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const job = {
    id: 'job',
    timestamp: 1,
    processedOn: 2,
    data: {
      mediaItemId: 'media',
      sourceLanguage: 'eng',
      targetLanguage: 'spa',
      sourceTrackIndex: 2,
      triggeredBy: 'manual',
      targetConflictResolution: 'replace',
    },
    progress,
    discard,
  } as unknown as Job<TranslationJobPayload>;
  return {
    processor,
    job,
    progress,
    discard,
    translationResult,
    controller,
    control,
    extraction,
    translate,
    output,
    usage,
    archive,
    events,
  };
}

describe('TranslationJobProcessor cancellation and accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it.each(['vtt', 'ssa'] as const)(
    'rejects a translated %s document before publishing media output',
    async (extension) => {
      const f = fixture();
      f.translate.translateDocument.mockResolvedValue({
        ...f.translationResult,
        extension,
      });
      await expect(f.processor.handle(f.job)).rejects.toThrow(
        `Unsupported extracted media subtitle format: ${extension}`,
      );
      expect(f.output.writeSubtitle).not.toHaveBeenCalled();
      expect(f.archive.appendSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'failed' }),
      );
      expect(fs.unlink).toHaveBeenCalledWith('/temporary/subtitle.srt');
    },
  );
  it('passes one shared abort signal through extraction, translation and atomic publication', async () => {
    const f = fixture();
    await f.processor.handle(f.job);
    expect(f.extraction.extractSubtitleTrack.mock.calls[0][3]).toEqual({
      signal: f.control.signal,
    });
    expect(f.translate.translateDocument.mock.calls[0][2]).toMatchObject({
      signal: f.control.signal,
      automatic: false,
    });
    expect(f.output.writeSubtitle.mock.calls[0][6]).toMatchObject({
      signal: f.control.signal,
      overwrite: true,
      itemId: 'media',
    });
    expect(f.control.stop).toHaveBeenCalled();
  });
  it('does not write or delete existing output when translation is cancelled', async () => {
    const f = fixture();
    f.translate.translateDocument.mockImplementation(() => {
      const error = new JobInterruptionError('user');
      f.controller.abort(error);
      return Promise.reject(error);
    });
    await expect(f.processor.handle(f.job)).resolves.toEqual({
      cancelled: true,
    });
    expect(f.output.writeSubtitle).not.toHaveBeenCalled();
    expect(f.archive.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'cancelled' }),
    );
    expect(fs.unlink).toHaveBeenCalledWith('/temporary/subtitle.srt');
    expect(f.discard).toHaveBeenCalled();
  });
  it('guards publication even when a provider returns successfully after cancellation', async () => {
    const f = fixture();
    f.translate.translateDocument.mockImplementation(() => {
      f.controller.abort(new JobInterruptionError('user'));
      return Promise.resolve(f.translationResult);
    });
    await expect(f.processor.handle(f.job)).resolves.toEqual({
      cancelled: true,
    });
    expect(f.output.writeSubtitle).not.toHaveBeenCalled();
  });
  it('records response usage directly once per attempt, without cumulative token delta callbacks', async () => {
    const f = fixture();
    const result = f.translationResult;
    const attempt = {
      provider: 'deepseek' as const,
      model: 'deepseek-chat',
      tier: 'paid' as const,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheHitTokens: 0,
      cacheMissTokens: 10,
    };
    f.translate.translateDocument.mockImplementation(
      async (_input, _filename, options) => {
        await options.onUsage?.(attempt);
        await options.onUsage?.(attempt);
        expect(options).not.toHaveProperty('onTokenUpdate');
        return result;
      },
    );
    await f.processor.handle(f.job);
    expect(f.usage.addProviderUsage).toHaveBeenCalledTimes(2);
    expect(f.usage.addProviderUsage).toHaveBeenNthCalledWith(1, attempt);
    expect(f.usage.addProviderUsage).toHaveBeenNthCalledWith(2, attempt);
  });
  it('archives stalled/restart work as failed, never as cancelled or completed', async () => {
    const f = fixture();
    f.translate.translateDocument.mockRejectedValue(
      new JobInterruptionError('stalled'),
    );
    await expect(f.processor.handle(f.job)).rejects.toThrow('server restarted');
    expect(f.archive.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'failed' }),
    );
    expect(f.archive.appendSnapshot.mock.calls[0][0].failedReason).toContain(
      'server restarted',
    );
    expect(f.output.writeSubtitle).not.toHaveBeenCalled();
    expect(f.discard).toHaveBeenCalled();
  });
  it('does not classify an arbitrary aborted signal as user cancellation', async () => {
    const f = fixture();
    f.translate.translateDocument.mockImplementation(() => {
      const error = new Error('Redis connection lost');
      f.controller.abort(error);
      return Promise.reject(error);
    });
    await expect(f.processor.handle(f.job)).rejects.toThrow(
      'Redis connection lost',
    );
    expect(f.archive.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'failed' }),
    );
  });
  it.each(['progress', 'archive'])(
    'returns committed output without retrying paid translation when completion %s fails',
    async (failure) => {
      const f = fixture();
      if (failure === 'progress')
        f.progress.mockImplementation((value) =>
          value === 100
            ? Promise.reject(new Error('completion Redis unavailable'))
            : Promise.resolve(),
        );
      else
        f.archive.appendSnapshot.mockRejectedValue(
          new Error('completion SQLite unavailable'),
        );
      await expect(f.processor.handle(f.job)).resolves.toMatchObject({
        outputPath: '/media/title.spa.srt',
        lineCount: 1,
      });
      expect(f.translate.translateDocument).toHaveBeenCalledTimes(1);
      expect(f.extraction.extractSubtitleTrack).toHaveBeenCalledTimes(1);
      expect(f.output.writeSubtitle).toHaveBeenCalledTimes(1);
      expect(f.discard).toHaveBeenCalled();
      const completion = f.events.publish.mock.calls.at(-1);
      expect(completion?.[0]).toBe('job');
      expect(completion?.[1].phase).toBe('completed');
      expect(completion?.[1].details).toHaveProperty(
        'warning',
        expect.stringContaining('unavailable'),
      );
    },
  );
});
