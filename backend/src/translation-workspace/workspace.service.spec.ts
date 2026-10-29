/// <reference lib="es2024.promise" />
jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExtractionService } from '../extraction/extraction.service';
import { GlossaryService } from '../glossary/glossary.service';
import { LibraryService } from '../library/library.service';
import { OutputService } from '../output/output.service';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import {
  TranslationService,
  type TranslationOptions,
} from '../translation/translation.service';
import { WorkspacePersistenceService } from './workspace-persistence.service';
import { WorkspaceService } from './workspace.service';

const source = Buffer.from(
  '7\n00:00:01,000 --> 00:00:03,000\n<i>Hello</i>\n\n7\n00:00:04,000 --> 00:00:06,000\nGoodbye\n',
);
const translated = Buffer.from(
  '7\n00:00:01,000 --> 00:00:03,000\n<i>Hola</i>\n\n7\n00:00:04,000 --> 00:00:06,000\nAdiós\n',
);
const input = () => ({
  source,
  translated,
  filename: 'sample.srt',
  sourceLang: 'en',
  targetLang: 'es',
});

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let root: string;
  const translation = { translateLines: jest.fn() };
  const settings = { getSettings: jest.fn() };
  const glossary = { formatForPrompt: jest.fn() };
  const library = { getById: jest.fn() };
  const output = {
    writeSubtitle: jest.fn(),
    listTranslationHistory: jest.fn(),
  };
  const config = { getOrThrow: jest.fn() };
  const persistence = { approve: jest.fn() };
  const usage = { addProviderUsage: jest.fn() };
  const extraction = { extractSubtitleTrack: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-workspace-'));
    settings.getSettings.mockResolvedValue({
      defaultProvider: 'openrouter',
      openRouterModel: 'test/model',
      deepSeekModel: 'deepseek-chat',
      openRouterApiKey: 'test-key',
      deepSeekApiKey: '',
      translationVerificationEnabled: true,
    });
    glossary.formatForPrompt.mockResolvedValue('');
    config.getOrThrow.mockReturnValue({ mediaDirs: [root], dataDir: root });
    usage.addProviderUsage.mockResolvedValue(undefined);
    persistence.approve.mockResolvedValue({ id: 'memory' });
    service = new WorkspaceService(
      translation as unknown as TranslationService,
      settings as unknown as SettingsService,
      glossary as unknown as GlossaryService,
      library as unknown as LibraryService,
      output as unknown as OutputService,
      config as unknown as ConfigService,
      persistence as unknown as WorkspacePersistenceService,
      usage as unknown as TokenUsageService,
      extraction as unknown as ExtractionService,
    );
  });

  afterEach(async () => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('paginates by ordinal even when source cue identifiers are duplicated', async () => {
    const { id } = await service.create(input());
    const page = service.get(id, 1, 1);
    expect(page.cueCount).toBe(2);
    expect(page.cues).toEqual([
      expect.objectContaining({
        cueIndex: 1,
        index: 7,
        source: 'Goodbye',
        text: 'Adiós',
      }),
    ]);
    expect(() => service.get(id, -1, 1)).toThrow(BadRequestException);
    expect(() => service.get(id, 0, 501)).toThrow(BadRequestException);
  });

  it('rejects stale revisions and commits valid edits atomically', async () => {
    const { id, revision } = await service.create(input());
    expect(
      service.edit(id, {
        expectedRevision: revision,
        edits: [{ cueIndex: 1, text: 'Hasta luego' }],
      }).revision,
    ).toBe(revision + 1);
    expect(() =>
      service.edit(id, {
        expectedRevision: revision,
        edits: [{ cueIndex: 1, text: 'Old' }],
      }),
    ).toThrow(ConflictException);
    expect(() =>
      service.updateContext(id, {
        expectedRevision: revision,
        contextSheet: 'Old',
      }),
    ).toThrow(ConflictException);
    expect(service.get(id).cues[1].text).toBe('Hasta luego');
  });

  it('rejects markup, cue-boundary injection, and invalid ordinal edits without changing anything', async () => {
    const { id, revision } = await service.create(input());
    const invalid = [
      [{ cueIndex: 0, text: 'Hola' }],
      [{ cueIndex: 1, text: '00:00:01,000 --> 00:00:02,000' }],
      [{ cueIndex: 1, text: 'bad\0text' }],
      [{ cueIndex: 1, text: '' }],
      [{ cueIndex: 2, text: 'Unknown' }],
      [
        { cueIndex: 1, text: 'First' },
        { cueIndex: 1, text: 'Duplicate' },
      ],
      [
        { cueIndex: 1, text: 'Valid' },
        { cueIndex: 0, text: 'Missing tags' },
      ],
    ];
    for (const edits of invalid) {
      expect(() =>
        service.edit(id, { expectedRevision: revision, edits }),
      ).toThrow(BadRequestException);
      expect(service.get(id).revision).toBe(revision);
      expect(service.get(id).cues[1].text).toBe('Adiós');
    }
  });

  it('lets humans re-break lines in edits and uploaded translations, and exports them', async () => {
    const { id, revision } = await service.create({
      ...input(),
      translated: Buffer.from(
        translated.toString().replace('Adiós', 'Adiós,\namigo'),
      ),
    });
    expect(service.get(id).cues[1]).toMatchObject({
      text: 'Adiós,\namigo',
      issues: [],
    });
    service.edit(id, {
      expectedRevision: revision,
      edits: [{ cueIndex: 0, text: '<i>Hola,\nqué tal</i>' }],
    });
    expect(service.download(id).content.toString()).toContain(
      '00:00:01,000 --> 00:00:03,000\n<i>Hola,\nqué tal</i>\n\n7\n00:00:04,000 --> 00:00:06,000\nAdiós,\namigo',
    );
  });

  it('validates translated cue timestamps and identity on creation', async () => {
    await expect(
      service.create({
        ...input(),
        translated: Buffer.from(
          translated.toString().replace('00:00:04,000', '00:00:04,001'),
        ),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        ...input(),
        translated: Buffer.from(
          translated.toString().replace('<i>Hola</i>', 'Hola'),
        ),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('limits sessions to twenty and allows a new session after explicit close', async () => {
    const sessions = [];
    for (let index = 0; index < 20; index++)
      sessions.push(await service.create(input()));
    await expect(service.create(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    service.delete(sessions[0].id);
    await expect(service.create(input())).resolves.toEqual({
      id: expect.any(String) as unknown as string,
      revision: 1,
    });
  });

  it('enforces the total retained twenty MiB budget, including edits, without evicting active sessions', async () => {
    const large = Buffer.from(
      `1\n00:00:01,000 --> 00:00:03,000\n${'x'.repeat(3 * 1024 * 1024)}\n`,
    );
    const { id } = await service.create({
      ...input(),
      source: large,
      translated: undefined,
    });
    await expect(
      service.create({ ...input(), source: large, translated: undefined }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(service.get(id).revision).toBe(1);
    await expect(
      service.create({ ...input(), source: Buffer.alloc(8 * 1024 * 1024 + 1) }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('expires sessions after an hour of idle time and renews TTL on access', async () => {
    let now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const first = await service.create(input());
    const second = await service.create(input());
    now += 59 * 60 * 1000;
    expect(service.get(first.id).expiresAt).toBe(
      new Date(now + 60 * 60 * 1000).toISOString(),
    );
    now += 60 * 1000;
    expect(() => service.get(second.id)).toThrow(NotFoundException);
    expect(service.get(first.id).id).toBe(first.id);
    now += 60 * 60 * 1000;
    expect(() => service.get(first.id)).toThrow(NotFoundException);
  });

  it('validates context and preserves metadata and original subtitle timing on download', async () => {
    const { id } = await service.create(input());
    expect(() =>
      service.updateContext(id, {
        expectedRevision: 1,
        contextSheet: 'x'.repeat(12001),
      }),
    ).toThrow(BadRequestException);
    const updated = service.updateContext(id, {
      expectedRevision: 1,
      contextSheet: 'A farewell scene',
    });
    expect(updated).toMatchObject({
      revision: 2,
      contextSheet: 'A farewell scene',
    });
    expect(service.download(id)).toEqual({
      filename: 'sample.es.srt',
      content: translated,
    });
    await expect(
      service.saveLibrary(id, { expectedRevision: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires explicit approval and stores only the manually selected cue with context and style signatures', async () => {
    const { id } = await service.create(input());
    await expect(
      service.approveMemory(id, {
        expectedRevision: 1,
        cueIndices: [0],
        approved: false as true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(persistence.approve).not.toHaveBeenCalled();
    await expect(
      service.approveMemory(id, {
        expectedRevision: 1,
        cueIndices: [0],
        approved: true,
      }),
    ).resolves.toEqual({ approved: 1 });
    expect(persistence.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        source: '<i>Hello</i>',
        target: '<i>Hola</i>',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        approved: true,
        contextHash: expect.stringMatching(
          /^[a-f0-9]{64}$/,
        ) as unknown as string,
        signature: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown as string,
      }),
    );
  });

  const flush = async () => {
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  };

  it('runs selected retranslation asynchronously, records durable usage, and applies only selected ordinals', async () => {
    const attempt = {
      provider: 'openrouter',
      model: 'test/model',
      tier: 'paid',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      cacheHitTokens: 0,
      cacheMissTokens: 3,
    };
    translation.translateLines.mockImplementation(
      async (
        _lines: string[],
        _target: string,
        _key: string,
        _key2: string,
        options: TranslationOptions,
      ) => {
        await options.onUsage!(
          attempt as Parameters<NonNullable<TranslationOptions['onUsage']>>[0],
        );
        await options.onProgress!({
          batchIndex: 1,
          totalBatches: 1,
          progressPercent: 100,
          message: 'Complete',
        });
        return { lines: ['Hasta luego'] };
      },
    );
    const { id } = await service.create(input());
    const operation = service.retranslate(id, {
      expectedRevision: 1,
      cueIndices: [1],
    });
    expect(['queued', 'running']).toContain(operation.status);
    await flush();
    expect(service.getOperation(id, operation.id)).toMatchObject({
      status: 'completed',
      revision: 2,
      progressPercent: 100,
    });
    expect(translation.translateLines).toHaveBeenCalledWith(
      ['Goodbye'],
      'es',
      'test-key',
      '',
      expect.objectContaining({
        onUsage: expect.any(Function) as unknown as (
          ...args: unknown[]
        ) => unknown,
        contextHint: expect.stringContaining('Hello') as unknown as string,
      }),
    );
    expect(usage.addProviderUsage).toHaveBeenCalledWith(attempt);
    expect(service.get(id).cues.map((cue) => cue.text)).toEqual([
      '<i>Hola</i>',
      'Hasta luego',
    ]);
    expect(persistence.approve).not.toHaveBeenCalled();
  });

  it('cancels in-flight operations and never applies a late result', async () => {
    const { promise, resolve: finish } = Promise.withResolvers<{
      lines: string[];
    }>();
    translation.translateLines.mockReturnValue(promise);
    const { id } = await service.create(input());
    const operation = service.retranslate(id, {
      expectedRevision: 1,
      cueIndices: [1],
    });
    await flush();
    expect(service.cancelOperation(id, operation.id).status).toBe('cancelled');
    finish({ lines: ['Late result'] });
    await flush();
    expect(service.getOperation(id, operation.id).status).toBe('cancelled');
    expect(service.get(id).revision).toBe(1);
  });

  it('does not overwrite concurrent manual edits when a translation completes', async () => {
    const { promise, resolve: finish } = Promise.withResolvers<{
      lines: string[];
    }>();
    translation.translateLines.mockReturnValue(promise);
    const { id } = await service.create(input());
    const operation = service.retranslate(id, {
      expectedRevision: 1,
      cueIndices: [1],
    });
    await flush();
    service.edit(id, {
      expectedRevision: 1,
      edits: [{ cueIndex: 1, text: 'Manual edit' }],
    });
    finish({ lines: ['Late result'] });
    await flush();
    expect(service.getOperation(id, operation.id).status).toBe('failed');
    expect(service.get(id).cues[1].text).toBe('Manual edit');
  });

  it('rejects invalid model results atomically and does not leak provider secrets in operation errors', async () => {
    translation.translateLines.mockResolvedValue({ lines: ['Removed markup'] });
    const { id } = await service.create(input());
    const operation = service.retranslate(id, {
      expectedRevision: 1,
      cueIndices: [0],
    });
    await flush();
    expect(service.getOperation(id, operation.id).status).toBe('failed');
    expect(service.get(id).revision).toBe(1);
    translation.translateLines.mockRejectedValue(
      new Error('secret-key and private request body'),
    );
    const failure = service.retranslate(id, {
      expectedRevision: 1,
      cueIndices: [1],
    });
    await flush();
    expect(service.getOperation(id, failure.id).error).not.toContain(
      'secret-key',
    );
  });

  it('loads only an authorized library sidecar and saves through OutputService with history and explicit overwrite', async () => {
    const mediaPath = path.join(root, 'movie.mkv');
    const subtitlePath = path.join(root, 'movie.es.srt');
    await fs.writeFile(mediaPath, 'media');
    await fs.writeFile(subtitlePath, translated);
    library.getById.mockResolvedValue({
      id: 'item',
      path: mediaPath,
      externalSubtitles: [
        { path: subtitlePath, language: 'es', forced: false },
      ],
      subtitleTracks: [],
    });
    output.writeSubtitle.mockResolvedValue(subtitlePath);
    const { id } = await service.openLibrary('item', { subtitlePath });
    expect(output.writeSubtitle).not.toHaveBeenCalled();
    expect(service.get(id).libraryMediaId).toBe('item');
    await expect(
      service.saveLibrary(id, { expectedRevision: 1, overwrite: true }),
    ).resolves.toEqual({ outputPath: subtitlePath });
    expect(output.writeSubtitle).toHaveBeenCalledWith(
      mediaPath,
      'es',
      translated.toString(),
      false,
      'srt',
      'default',
      { overwrite: true, itemId: 'item' },
    );
  });

  it('rejects arbitrary paths, unlisted siblings, traversal, and sidecars outside configured roots', async () => {
    const mediaPath = path.join(root, 'movie.mkv');
    await fs.writeFile(mediaPath, 'media');
    library.getById.mockResolvedValue({
      id: 'item',
      path: mediaPath,
      externalSubtitles: [],
      subtitleTracks: [],
    });
    output.listTranslationHistory.mockResolvedValue([]);
    for (const subtitlePath of [
      path.join(root, 'unlisted.srt'),
      '../outside.srt',
      '..\\outside.srt',
    ])
      await expect(
        service.openLibrary('item', { subtitlePath }),
      ).rejects.toBeInstanceOf(BadRequestException);
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), 'subsarr-workspace-outside-'),
    );
    try {
      const subtitlePath = path.join(outside, 'movie.es.srt');
      await fs.writeFile(subtitlePath, translated);
      library.getById.mockResolvedValue({
        id: 'item',
        path: mediaPath,
        externalSubtitles: [{ path: subtitlePath, language: 'es' }],
        subtitleTracks: [],
      });
      await expect(
        service.openLibrary('item', { subtitlePath }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
    expect(output.writeSubtitle).not.toHaveBeenCalled();
  });

  it('loads only listed history basenames and rejects unowned embedded track indices', async () => {
    const mediaPath = path.join(root, 'movie.mkv');
    await fs.writeFile(mediaPath, 'media');
    const history = path.join(root, 'history', 'item');
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, 'saved.srt'), translated);
    output.listTranslationHistory.mockResolvedValue(['saved.srt']);
    library.getById.mockResolvedValue({
      id: 'item',
      path: mediaPath,
      externalSubtitles: [],
      subtitleTracks: [],
    });
    const { id } = await service.openLibrary('item', {
      subtitlePath: 'saved.srt',
      targetLanguage: 'es',
    });
    expect(service.get(id).libraryMediaId).toBe('item');
    await expect(
      service.openLibrary('item', {
        subtitlePath: 'saved.srt',
        sourceTrackIndex: 9,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(extraction.extractSubtitleTrack).not.toHaveBeenCalled();
  });
});
