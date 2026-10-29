jest.mock('../settings/settings.service', () => ({
  SettingsService: class {},
}));
jest.mock('../library/library.service', () => ({
  LibraryService: class {},
}));
jest.mock('./jobs.service', () => ({ JobsService: class {} }));
jest.mock('../notifications/telegram.service', () => ({
  TelegramService: class {},
}));

import { Logger } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { Repository } from 'typeorm';
import type { JobSchedulerStateEntity } from '../database/entities/job-scheduler-state.entity';
import type { LibraryService } from '../library/library.service';
import type { MediaItem } from '../library/media-item.entity';
import type { TelegramService } from '../notifications/telegram.service';
import type { SettingsService } from '../settings/settings.service';
import type { RuntimeSettings } from '../settings/settings.types';
import type { JobsService } from './jobs.service';
import { LibraryScanSchedulerService } from './library-scan-scheduler.service';

function media(
  id: string,
  probeStatus: MediaItem['probeStatus'],
  subtitleTracks = probeStatus === 'ok',
): MediaItem {
  return {
    id,
    path: `/media/${id}.mkv`,
    name: id,
    type: 'movie',
    probeStatus,
    subtitleTracks: subtitleTracks
      ? [{ index: 2, language: 'eng', codec: 'subrip' }]
      : [],
    externalSubtitles: [],
    size: 100,
    lastModified: new Date(0),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('LibraryScanSchedulerService', () => {
  let service: LibraryScanSchedulerService;
  let settings: RuntimeSettings;
  let settingsService: { getSettings: jest.Mock };
  let libraryService: { getCachedItems: jest.Mock; getLibrary: jest.Mock };
  let jobsService: { enqueue: jest.Mock };
  let telegramService: { notifyScanCompleted: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    settings = {
      mediaDirs: ['/media'],
      sourceLanguage: 'eng',
      targetLanguage: 'spa',
      openRouterApiKey: '',
      deepSeekApiKey: '',
      openRouterModel: '',
      deepSeekModel: '',
      opencodeGoApiKey: '',
      opencodeGoModel: 'glm-5.2',
      defaultProvider: 'openrouter',
      scanCacheTtlMinutes: 5,
      concurrency: 2,
      pathContainsExclusions: [],
      translationVerificationEnabled: false,
      rules: [],
      autoScanEnabled: true,
      autoScanCronExpression: '0 * * * *',
      autoTranslateNewItems: true,
      telegramEnabled: false,
      telegramEvents: [],
    };
    settingsService = { getSettings: jest.fn().mockResolvedValue(settings) };
    libraryService = {
      getCachedItems: jest.fn().mockReturnValue([]),
      getLibrary: jest.fn().mockResolvedValue([]),
    };
    jobsService = { enqueue: jest.fn().mockResolvedValue(undefined) };
    telegramService = {
      notifyScanCompleted: jest.fn().mockResolvedValue(undefined),
    };
    service = new LibraryScanSchedulerService(
      settingsService as unknown as SettingsService,
      libraryService as unknown as LibraryService,
      jobsService as unknown as JobsService,
      {} as SchedulerRegistry,
      telegramService as unknown as TelegramService,
    );
  });

  it.each(['failed', 'pending'] as const)(
    'keeps a %s discovery pending until stable and successfully probed',
    async (status) => {
      const failed = media('pending', status);
      libraryService.getLibrary.mockResolvedValue([failed]);
      await service.runScheduledScan();

      const skipped = media('pending', 'skipped');
      libraryService.getCachedItems.mockReturnValue([failed]);
      libraryService.getLibrary.mockResolvedValue([skipped]);
      await service.runScheduledScan();
      expect(jobsService.enqueue).not.toHaveBeenCalled();

      const recovered = media('pending', 'ok');
      libraryService.getCachedItems.mockReturnValue([skipped]);
      libraryService.getLibrary.mockResolvedValue([recovered]);
      await service.runScheduledScan();
      await service.runScheduledScan();
      expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ mediaItemId: 'pending' }),
      );
    },
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds a cold baseline without enqueueing the existing library', async () => {
    const existing = media('existing', 'ok');
    libraryService.getCachedItems.mockReturnValue(null);
    libraryService.getLibrary.mockResolvedValue([existing]);

    await service.runScheduledScan();

    expect(libraryService.getCachedItems).toHaveBeenCalledTimes(1);
    expect(libraryService.getLibrary).toHaveBeenCalledTimes(1);
    expect(libraryService.getLibrary).toHaveBeenCalledWith(true, 'scheduled');
    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(telegramService.notifyScanCompleted).toHaveBeenCalledWith({
      totalItems: 1,
      newItems: 0,
      seconds: expect.any(String) as unknown,
    });

    libraryService.getCachedItems.mockReturnValue([existing]);
    libraryService.getLibrary.mockResolvedValue([existing, media('new', 'ok')]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'new' }),
    );
  });

  it('scans once and enqueues only genuinely new items from a ready baseline', async () => {
    libraryService.getCachedItems.mockReturnValue([media('existing', 'ok')]);
    libraryService.getLibrary.mockResolvedValue([
      media('existing', 'ok'),
      media('new', 'ok'),
    ]);

    await service.runScheduledScan();

    expect(libraryService.getLibrary).toHaveBeenCalledTimes(1);
    expect(libraryService.getLibrary).toHaveBeenCalledWith(true, 'scheduled');
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith({
      mediaItemId: 'new',
      sourceLanguage: 'eng',
      targetLanguage: 'spa',
      sourceTrackIndex: 2,
      triggeredBy: 'auto-scan',
      targetConflictResolution: 'replace',
    });
    expect(telegramService.notifyScanCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ totalItems: 2, newItems: 1 }),
    );
  });

  it('remembers known files through disappearance and failed-probe recovery', async () => {
    const known = media('known', 'ok');
    libraryService.getCachedItems.mockReturnValue([known]);
    libraryService.getLibrary.mockResolvedValue([]);
    await service.runScheduledScan();

    libraryService.getCachedItems.mockReturnValue([]);
    libraryService.getLibrary.mockResolvedValue([media('known', 'failed')]);
    await service.runScheduledScan();

    libraryService.getCachedItems.mockReturnValue([media('known', 'failed')]);
    libraryService.getLibrary.mockResolvedValue([known]);
    await service.runScheduledScan();

    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(telegramService.notifyScanCompleted).toHaveBeenLastCalledWith(
      expect.objectContaining({ totalItems: 1, newItems: 0 }),
    );
  });

  it('remembers additions observed in the current cache between scheduled runs', async () => {
    await service.runScheduledScan();
    libraryService.getCachedItems.mockReturnValue([media('interactive', 'ok')]);
    libraryService.getLibrary.mockResolvedValue([]);
    await service.runScheduledScan();

    libraryService.getCachedItems.mockReturnValue([]);
    libraryService.getLibrary.mockResolvedValue([media('interactive', 'ok')]);
    await service.runScheduledScan();

    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('retains new failed items through repeated negative-cache scans and enqueues recovery once', async () => {
    const failed = media('new', 'failed');
    libraryService.getLibrary.mockResolvedValue([failed]);
    await service.runScheduledScan();

    libraryService.getCachedItems.mockReturnValue([failed]);
    await service.runScheduledScan();
    await service.runScheduledScan();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(telegramService.notifyScanCompleted).toHaveBeenLastCalledWith(
      expect.objectContaining({ totalItems: 1, newItems: 0 }),
    );

    const recovered = media('new', 'ok');
    libraryService.getLibrary.mockResolvedValue([recovered]);
    await service.runScheduledScan();
    libraryService.getCachedItems.mockReturnValue([recovered]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'new' }),
    );
  });

  it('seeds healthy cold-baseline items but queues a failed baseline item when it recovers', async () => {
    const healthy = media('healthy', 'ok');
    const failed = media('recovering', 'failed');
    libraryService.getCachedItems.mockReturnValue(null);
    libraryService.getLibrary.mockResolvedValue([healthy, failed]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).not.toHaveBeenCalled();

    libraryService.getCachedItems.mockReturnValue([healthy, failed]);
    libraryService.getLibrary.mockResolvedValue([
      healthy,
      media('recovering', 'ok'),
    ]);
    await service.runScheduledScan();
    await service.runScheduledScan();
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'recovering' }),
    );
  });

  it('keeps failed baseline discoveries pending when an interactive scan recovers them', async () => {
    const failed = media('interactive-recovery', 'failed');
    libraryService.getCachedItems.mockReturnValue([failed]);
    libraryService.getLibrary.mockResolvedValue([failed]);
    await service.runScheduledScan();

    const recovered = media('interactive-recovery', 'ok');
    libraryService.getCachedItems.mockReturnValue([recovered]);
    libraryService.getLibrary.mockResolvedValue([recovered]);
    await service.runScheduledScan();
    await service.runScheduledScan();
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'interactive-recovery' }),
    );
  });

  it('does not retry a successful probe with no source tracks as a failed discovery', async () => {
    const failed = media('empty', 'failed');
    libraryService.getLibrary.mockResolvedValue([failed]);
    await service.runScheduledScan();

    const empty = media('empty', 'ok', false);
    libraryService.getCachedItems.mockReturnValue([failed]);
    libraryService.getLibrary.mockResolvedValue([empty]);
    await service.runScheduledScan();
    expect(telegramService.notifyScanCompleted).toHaveBeenLastCalledWith(
      expect.objectContaining({ totalItems: 1, newItems: 1 }),
    );

    libraryService.getCachedItems.mockReturnValue([empty]);
    libraryService.getLibrary.mockResolvedValue([media('empty', 'ok')]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(telegramService.notifyScanCompleted).toHaveBeenLastCalledWith(
      expect.objectContaining({ totalItems: 1, newItems: 0 }),
    );
  });

  it('seeds a changed root safely while allowing its failed discoveries to recover', async () => {
    await service.runScheduledScan();
    settings.mediaDirs = ['/other'];
    const healthy = media('other-healthy', 'ok');
    const failed = media('other-failed', 'failed');
    libraryService.getLibrary.mockResolvedValue([healthy, failed]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).not.toHaveBeenCalled();

    const recovered = media('other-failed', 'ok');
    libraryService.getCachedItems.mockReturnValue([healthy, recovered]);
    libraryService.getLibrary.mockResolvedValue([healthy, recovered]);
    await service.runScheduledScan();
    await service.runScheduledScan();
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'other-failed' }),
    );
  });

  it('reseeds after root changes, including switching back, instead of mass enqueueing', async () => {
    libraryService.getCachedItems.mockReturnValue([media('old-root', 'ok')]);
    libraryService.getLibrary.mockResolvedValue([media('old-root', 'ok')]);
    await service.runScheduledScan();

    settings.mediaDirs = ['/other'];
    libraryService.getLibrary.mockResolvedValue([media('other-root', 'ok')]);
    await service.runScheduledScan();

    settings.mediaDirs = ['/media'];
    libraryService.getCachedItems.mockReturnValue([media('other-root', 'ok')]);
    libraryService.getLibrary.mockResolvedValue([media('old-root', 'ok')]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).not.toHaveBeenCalled();

    libraryService.getCachedItems.mockReturnValue([media('old-root', 'ok')]);
    libraryService.getLibrary.mockResolvedValue([
      media('old-root', 'ok'),
      media('genuine-new', 'ok'),
    ]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'genuine-new' }),
    );
  });

  it('retains known IDs when a file is absent while its root is reselected', async () => {
    libraryService.getCachedItems.mockReturnValue([media('known', 'ok')]);
    libraryService.getLibrary.mockResolvedValue([media('known', 'ok')]);
    await service.runScheduledScan();

    settings.mediaDirs = ['/other'];
    libraryService.getLibrary.mockResolvedValue([]);
    await service.runScheduledScan();

    settings.mediaDirs = ['/media'];
    libraryService.getCachedItems.mockReturnValue([]);
    await service.runScheduledScan();

    libraryService.getLibrary.mockResolvedValue([media('known', 'ok')]);
    await service.runScheduledScan();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('does not reset the baseline when only root order or duplicates change', async () => {
    settings.mediaDirs = ['/media', '/other'];
    await service.runScheduledScan();
    settings.mediaDirs = ['/other', '/media', '/media'];
    libraryService.getLibrary.mockResolvedValue([media('new', 'ok')]);

    await service.runScheduledScan();

    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps reseeding after a root-change scan fails', async () => {
    await service.runScheduledScan();
    settings.mediaDirs = ['/other'];
    libraryService.getLibrary.mockRejectedValueOnce(new Error('unavailable'));
    await service.runScheduledScan();
    libraryService.getLibrary.mockResolvedValue([media('other-root', 'ok')]);

    await service.runScheduledScan();

    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(telegramService.notifyScanCompleted).toHaveBeenCalledTimes(2);
  });

  it('guards the lifecycle while settings are pending and recovers after failure', async () => {
    const pendingSettings = deferred<RuntimeSettings>();
    settingsService.getSettings.mockReturnValueOnce(pendingSettings.promise);
    const running = service.runScheduledScan();
    await service.runScheduledScan();
    expect(settingsService.getSettings).toHaveBeenCalledTimes(1);
    pendingSettings.resolve(settings);
    await running;

    settingsService.getSettings.mockRejectedValueOnce(
      new Error('settings failed'),
    );
    await service.runScheduledScan();
    await service.runScheduledScan();
    expect(libraryService.getLibrary).toHaveBeenCalledTimes(2);
  });

  it('guards diff and enqueue after the library scan has already finished', async () => {
    const enqueueStarted = deferred<void>();
    const pendingEnqueue = deferred<void>();
    libraryService.getLibrary.mockResolvedValue([media('new', 'ok')]);
    jobsService.enqueue.mockImplementationOnce(() => {
      enqueueStarted.resolve();
      return pendingEnqueue.promise;
    });
    const running = service.runScheduledScan();
    await enqueueStarted.promise;

    await service.runScheduledScan();
    expect(libraryService.getLibrary).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    pendingEnqueue.resolve();
    await running;

    await service.runScheduledScan();
    expect(libraryService.getLibrary).toHaveBeenCalledTimes(2);
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('guards notification completion and releases the guard on notification errors', async () => {
    const notificationStarted = deferred<void>();
    const pendingNotification = deferred<void>();
    telegramService.notifyScanCompleted.mockImplementationOnce(() => {
      notificationStarted.resolve();
      return pendingNotification.promise;
    });
    const running = service.runScheduledScan();
    await notificationStarted.promise;
    await service.runScheduledScan();
    expect(libraryService.getLibrary).toHaveBeenCalledTimes(1);
    pendingNotification.resolve();
    await running;

    telegramService.notifyScanCompleted.mockRejectedValueOnce(
      new Error('notification failed'),
    );
    await service.runScheduledScan();
    await service.runScheduledScan();
    expect(libraryService.getLibrary).toHaveBeenCalledTimes(3);
  });

  it('releases the guard when disabled and preserves auto-translate and track checks', async () => {
    settings.autoScanEnabled = false;
    await service.runScheduledScan();
    expect(libraryService.getLibrary).not.toHaveBeenCalled();

    settings.autoScanEnabled = true;
    settings.autoTranslateNewItems = false;
    libraryService.getLibrary.mockResolvedValue([media('disabled', 'ok')]);
    await service.runScheduledScan();
    settings.autoTranslateNewItems = true;
    libraryService.getLibrary.mockResolvedValue([
      media('disabled', 'ok'),
      media('missing-source', 'ok', false),
      media('eligible', 'ok'),
    ]);
    await service.runScheduledScan();

    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mediaItemId: 'eligible' }),
    );
  });

  describe('durable checkpoints', () => {
    function durableScheduler(initial: JobSchedulerStateEntity | null = null) {
      let checkpoint = initial;
      const repository = {
        findOneBy: jest
          .fn()
          .mockImplementation(() => Promise.resolve(checkpoint)),
        save: jest.fn().mockImplementation((state: JobSchedulerStateEntity) => {
          checkpoint = {
            ...state,
            knownItemIds: [...state.knownItemIds],
            pendingProbeItemIds: [...state.pendingProbeItemIds],
          };
          return Promise.resolve(checkpoint);
        }),
      };
      const restart = () =>
        new LibraryScanSchedulerService(
          settingsService as unknown as SettingsService,
          libraryService as unknown as LibraryService,
          jobsService as unknown as JobsService,
          {} as SchedulerRegistry,
          telegramService as unknown as TelegramService,
          repository as unknown as Repository<JobSchedulerStateEntity>,
        );
      return { repository, restart, checkpoint: () => checkpoint };
    }

    it('restores on startup even when auto-scan is disabled', async () => {
      settings.autoScanEnabled = false;
      const durable = durableScheduler({
        id: 'libraryAutoScan',
        knownItemIds: ['known'],
        pendingProbeItemIds: ['pending'],
        mediaRootsKey: '["/media"]',
      });
      service = durable.restart();
      await service.onModuleInit();
      await service.runScheduledScan();

      expect(durable.repository.findOneBy).toHaveBeenCalledTimes(1);
      expect(durable.repository.findOneBy).toHaveBeenCalledWith({
        id: 'libraryAutoScan',
      });
      expect(durable.repository.save).not.toHaveBeenCalled();
      expect(libraryService.getLibrary).not.toHaveBeenCalled();
    });

    it('uses the restored baseline lazily before a run without a current cache', async () => {
      const durable = durableScheduler();
      libraryService.getCachedItems.mockReturnValue(null);
      libraryService.getLibrary.mockResolvedValue([media('existing', 'ok')]);
      await durable.restart().runScheduledScan();
      expect(jobsService.enqueue).not.toHaveBeenCalled();

      libraryService.getLibrary.mockResolvedValue([
        media('existing', 'ok'),
        media('new', 'ok'),
      ]);
      await durable.restart().runScheduledScan();

      expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ mediaItemId: 'new' }),
      );
      expect(durable.checkpoint()).toEqual({
        id: 'libraryAutoScan',
        knownItemIds: ['existing', 'new'],
        pendingProbeItemIds: [],
        mediaRootsKey: '["/media"]',
      });
    });

    it.each(['failed', 'pending'] as const)(
      'preserves %s discoveries through restarts, disappearance, skips and repair',
      async (status) => {
        const durable = durableScheduler();
        libraryService.getLibrary.mockResolvedValue([media('pending', status)]);
        await durable.restart().runScheduledScan();
        expect(durable.checkpoint()?.pendingProbeItemIds).toEqual(['pending']);

        libraryService.getCachedItems.mockReturnValue([]);
        libraryService.getLibrary.mockResolvedValue([]);
        await durable.restart().runScheduledScan();
        libraryService.getLibrary.mockResolvedValue([
          media('pending', 'skipped'),
        ]);
        await durable.restart().runScheduledScan();
        expect(durable.checkpoint()?.pendingProbeItemIds).toEqual(['pending']);
        expect(jobsService.enqueue).not.toHaveBeenCalled();

        const repaired = media('pending', 'ok');
        libraryService.getCachedItems.mockReturnValue([repaired]);
        libraryService.getLibrary.mockResolvedValue([repaired]);
        await durable.restart().runScheduledScan();
        await durable.restart().runScheduledScan();
        expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
        expect(durable.checkpoint()?.pendingProbeItemIds).toEqual([]);
        expect(durable.checkpoint()?.knownItemIds).toEqual(['pending']);
      },
    );

    it('keeps previously healthy IDs known after disappearance, failure, restart and repair', async () => {
      const durable = durableScheduler();
      libraryService.getCachedItems.mockReturnValue([media('known', 'ok')]);
      libraryService.getLibrary.mockResolvedValue([]);
      await durable.restart().runScheduledScan();

      libraryService.getCachedItems.mockReturnValue([]);
      libraryService.getLibrary.mockResolvedValue([media('known', 'failed')]);
      await durable.restart().runScheduledScan();
      expect(durable.checkpoint()?.knownItemIds).toEqual(['known']);
      expect(durable.checkpoint()?.pendingProbeItemIds).toEqual([]);

      libraryService.getCachedItems.mockReturnValue([media('known', 'failed')]);
      libraryService.getLibrary.mockResolvedValue([media('known', 'ok')]);
      await durable.restart().runScheduledScan();
      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('does not commit failed root changes and reseeds safely after restart', async () => {
      const durable = durableScheduler();
      await durable.restart().runScheduledScan();
      settings.mediaDirs = ['/other'];
      libraryService.getLibrary.mockRejectedValueOnce(
        new Error('root unavailable'),
      );
      await durable.restart().runScheduledScan();
      expect(durable.repository.save).toHaveBeenCalledTimes(1);
      expect(durable.checkpoint()?.mediaRootsKey).toBe('["/media"]');

      libraryService.getLibrary.mockResolvedValue([
        media('other-healthy', 'ok'),
        media('other-pending', 'failed'),
      ]);
      await durable.restart().runScheduledScan();
      expect(jobsService.enqueue).not.toHaveBeenCalled();
      expect(durable.checkpoint()?.mediaRootsKey).toBe('["/other"]');

      const recovered = media('other-pending', 'ok');
      libraryService.getCachedItems.mockReturnValue([recovered]);
      libraryService.getLibrary.mockResolvedValue([recovered]);
      await durable.restart().runScheduledScan();
      expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ mediaItemId: 'other-pending' }),
      );
    });

    it('preserves a failed discovery checkpoint if the next scan fails entirely', async () => {
      const durable = durableScheduler();
      libraryService.getLibrary.mockResolvedValue([media('pending', 'failed')]);
      await durable.restart().runScheduledScan();
      libraryService.getLibrary.mockRejectedValueOnce(
        new Error('root unavailable'),
      );
      await durable.restart().runScheduledScan();
      expect(durable.repository.save).toHaveBeenCalledTimes(1);
      expect(durable.checkpoint()?.pendingProbeItemIds).toEqual(['pending']);

      libraryService.getCachedItems.mockReturnValue(null);
      libraryService.getLibrary.mockResolvedValue([media('pending', 'ok')]);
      await durable.restart().runScheduledScan();
      expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    });

    it('does not scan with unread checkpoint history and retries restoration next run', async () => {
      const durable = durableScheduler({
        id: 'libraryAutoScan',
        knownItemIds: ['known'],
        pendingProbeItemIds: [],
        mediaRootsKey: '["/media"]',
      });
      durable.repository.findOneBy.mockRejectedValueOnce(
        new Error('database unavailable'),
      );
      service = durable.restart();
      await service.runScheduledScan();
      expect(libraryService.getLibrary).not.toHaveBeenCalled();
      expect(durable.repository.save).not.toHaveBeenCalled();

      libraryService.getLibrary.mockResolvedValue([media('known', 'ok')]);
      await service.runScheduledScan();
      expect(durable.repository.findOneBy).toHaveBeenCalledTimes(2);
      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });
  });
});
