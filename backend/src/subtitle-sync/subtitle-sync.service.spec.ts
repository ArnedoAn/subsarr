import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { ExtractionService } from '../extraction/extraction.service';
import type { JellyfinService } from '../integrations/jellyfin.service';
import type { LibraryService } from '../library/library.service';
import type { MediaItem } from '../library/media-item.entity';
import { OutputService } from '../output/output.service';
import { runFfsubsync } from './ffsubsync-runner';
import { SubtitleSyncService } from './subtitle-sync.service';
import type { SubtitleSyncTask } from './subtitle-sync.types';

jest.mock('./ffsubsync-runner', () => ({ runFfsubsync: jest.fn() }));
const engine = runFfsubsync as jest.MockedFunction<typeof runFfsubsync>;

const SRT =
  '1\n00:00:05,000 --> 00:00:06,000\nHello\n\n2\n00:00:08,000 --> 00:00:09,000\nWorld\n';
const SHIFTED =
  '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:04,000 --> 00:00:05,000\nWorld\n';

describe('SubtitleSyncService', () => {
  let root: string;
  let mediaPath: string;
  let item: MediaItem;
  let extraction: { extractSubtitleTrack: jest.Mock };
  let service: SubtitleSyncService;

  const settle = async (id: string): Promise<SubtitleSyncTask> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const task = service.get(id);
      if (!['queued', 'running'].includes(task.state)) return task;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('sync did not settle');
  };
  const upload = (content = SRT, originalname = 'other.release.srt') => ({
    originalname,
    buffer: Buffer.from(content),
  });

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-sync-spec-')),
    );
    mediaPath = path.join(root, 'Movie.mkv');
    await fs.writeFile(mediaPath, 'video');
    item = {
      id: 'movie',
      path: mediaPath,
      name: 'Movie',
      type: 'movie',
      probeStatus: 'ok',
      subtitleTracks: [
        { index: 2, language: 'eng', codec: 'hdmv_pgs_subtitle' },
        { index: 3, language: 'eng', codec: 'subrip', title: 'Forced' },
        { index: 4, language: 'fre', codec: 'subrip' },
      ],
      externalSubtitles: [],
      size: 5,
      lastModified: new Date(),
    } as unknown as MediaItem;
    const config = {
      getOrThrow: () => ({
        mediaDirs: [root],
        dataDir: path.join(root, 'data'),
        syncPython: 'python3',
      }),
    } as unknown as ConfigService;
    extraction = {
      extractSubtitleTrack: jest.fn(async () => {
        const tempFilePath = path.join(root, `ref-${Date.now()}.srt`);
        await fs.writeFile(tempFilePath, SRT);
        return { tempFilePath, sizeBytes: SRT.length };
      }),
    };
    engine.mockReset();
    engine.mockImplementation(async (request) => {
      await fs.writeFile(request.output, SRT);
      return { synced: true, offsetSeconds: 4, framerateScaleFactor: 1 };
    });
    service = new SubtitleSyncService(
      config,
      { getById: () => Promise.resolve(item) } as unknown as LibraryService,
      extraction as unknown as ExtractionService,
      new OutputService(config),
      {
        refreshLibraryAfterSubtitle: () => Promise.resolve(),
      } as unknown as JellyfinService,
    );
  });

  afterEach(async () => {
    service.onModuleDestroy();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('aligns against the first full embedded text track and publishes beside the video', async () => {
    const started = await service.start(
      { mediaItemId: 'movie', language: 'spa' },
      upload(SHIFTED),
    );
    const task = await settle(started.id);

    expect(task.state).toBe('completed');
    // PGS is image-based and the forced track is partial; the French track is the reference.
    expect(extraction.extractSubtitleTrack).toHaveBeenCalledWith(
      mediaPath,
      4,
      'srt',
      expect.anything(),
    );
    expect(task.reference).toEqual({
      kind: 'track',
      trackIndex: 4,
      language: 'fre',
    });
    expect(engine.mock.calls[0][0].referenceIsAudio).toBe(false);
    expect(task.result).toMatchObject({
      outputPath: path.join(root, 'Movie.spa.srt'),
      offsetSeconds: 4,
      cueCount: 2,
    });
    await expect(
      fs.readFile(path.join(root, 'Movie.spa.srt'), 'utf8'),
    ).resolves.toBe(SRT);
  });

  it('falls back to audio when the video has no usable text subtitle', async () => {
    item.subtitleTracks = item.subtitleTracks.slice(0, 2);
    const task = await settle(
      (await service.start({ mediaItemId: 'movie', language: 'spa' }, upload()))
        .id,
    );

    expect(task.reference).toEqual({ kind: 'audio' });
    expect(engine.mock.calls[0][0]).toMatchObject({
      reference: mediaPath,
      referenceIsAudio: true,
    });
    expect(extraction.extractSubtitleTrack).not.toHaveBeenCalled();
  });

  it('writes nothing when the alignment is untrustworthy', async () => {
    engine.mockResolvedValue({
      synced: false,
      offsetSeconds: 0,
      framerateScaleFactor: 1,
    });
    const task = await settle(
      (
        await service.start(
          { mediaItemId: 'movie', language: 'spa', reference: 'audio' },
          upload(),
        )
      ).id,
    );

    expect(task.state).toBe('failed');
    expect(task.error).toMatch(/No trustworthy alignment/);
    await expect(fs.access(path.join(root, 'Movie.spa.srt'))).rejects.toThrow();
  });

  it('refuses to clobber an existing subtitle unless replace or alternate is chosen', async () => {
    await fs.writeFile(path.join(root, 'Movie.spa.srt'), 'old');

    await expect(
      service.start({ mediaItemId: 'movie', language: 'spa' }, upload()),
    ).rejects.toThrow(/already exists/);
    const task = await settle(
      (
        await service.start(
          { mediaItemId: 'movie', language: 'spa', conflict: 'alternate' },
          upload(),
        )
      ).id,
    );

    expect(task.result?.outputPath).toBe(path.join(root, 'Movie.spa.2.srt'));
    await expect(
      fs.readFile(path.join(root, 'Movie.spa.srt'), 'utf8'),
    ).resolves.toBe('old');
  });

  it('re-syncs a listed sidecar in place, inheriting its language and forced flag', async () => {
    const sidecar = path.join(root, 'Movie.por.forced.srt');
    await fs.writeFile(sidecar, SHIFTED);
    item.externalSubtitles = [{ path: sidecar, language: 'por', forced: true }];

    const task = await settle(
      (
        await service.start({
          mediaItemId: 'movie',
          sidecarPath: sidecar,
          reference: 'audio',
          conflict: 'replace',
        })
      ).id,
    );

    expect(task).toMatchObject({ state: 'completed', language: 'por' });
    expect(task.result?.outputPath).toBe(sidecar);
    await expect(fs.readFile(sidecar, 'utf8')).resolves.toBe(SRT);
  });

  it.each([
    [{ sidecarPath: '/elsewhere/file.srt' }, undefined, /listed/],
    [{}, undefined, /either an uploaded/],
    [
      { reference: 'track' as const, referenceTrackIndex: 2 },
      'upload',
      /text subtitle/,
    ],
    [{}, 'notes.txt', /Unsupported subtitle format/],
  ])('rejects invalid input %p before queuing', async (fields, file, error) => {
    await expect(
      service.start(
        { mediaItemId: 'movie', language: 'spa', ...fields },
        file === 'upload' ? upload() : file ? upload(SRT, file) : undefined,
      ),
    ).rejects.toThrow(error);
    expect(service.list('movie')).toEqual([]);
  });

  it('cancels a queued sync without running the engine', async () => {
    let release!: () => void;
    engine.mockImplementationOnce(async (request) => {
      await new Promise<void>((resolve) => (release = resolve));
      await fs.writeFile(request.output, SRT);
      return { synced: true, offsetSeconds: 0, framerateScaleFactor: 1 };
    });
    const first = await service.start(
      { mediaItemId: 'movie', language: 'spa', reference: 'audio' },
      upload(),
    );
    const second = await service.start(
      {
        mediaItemId: 'movie',
        language: 'spa',
        reference: 'audio',
        conflict: 'alternate',
      },
      upload(),
    );
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));

    expect(service.cancel(second.id).state).toBe('cancelled');
    release();
    expect((await settle(first.id)).state).toBe('completed');
    expect(engine).toHaveBeenCalledTimes(1);
  });
});
