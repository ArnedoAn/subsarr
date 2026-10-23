import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Repository } from 'typeorm';
import { RenameJournalEntity } from '../database/entities/rename-journal.entity';
import { SettingsService } from '../settings/settings.service';
import { RenameService } from './rename.service';

describe('RenameService server-issued plans and durable undo', () => {
  let service: RenameService;
  let directory: string;
  let records: Map<string, RenameJournalEntity>;
  let settings: SettingsService;
  let repository: Repository<RenameJournalEntity>;
  let config: ConfigService;
  let selectedRoots: string[];
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'subsarr-rename-'));
    records = new Map();
    selectedRoots = [directory];
    config = new ConfigService({ subsync: { mediaDirs: [directory] } });
    // Minimal in-memory persistence seam; filesystem operations remain real temporary files.
    settings = {
      getSettings: () => Promise.resolve({ mediaDirs: selectedRoots }),
    } as unknown as SettingsService;
    repository = {
      create: (entry: RenameJournalEntity) => ({ ...entry }),
      save: (entry: RenameJournalEntity) => {
        records.set(entry.id, { ...entry });
        return Promise.resolve(entry);
      },
      find: (options?: { where?: { batchId?: string } }) =>
        Promise.resolve(
          [...records.values()].filter(
            (entry) =>
              !options?.where?.batchId ||
              entry.batchId === options.where.batchId,
          ),
        ),
    } as unknown as Repository<RenameJournalEntity>;
    service = new RenameService(settings, repository, config);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('rejects legacy selected roots outside the environment even when the media exists', async () => {
    const authorized = path.join(directory, 'authorized');
    await mkdir(authorized);
    const source = path.join(directory, 'Movie.2020.mkv');
    const destination = path.join(directory, 'Movie (2020).mkv');
    await writeFile(source, 'legacy media');
    config = new ConfigService({ subsync: { mediaDirs: [authorized] } });
    service = new RenameService(settings, repository, config);

    await expect(service.getPreview(directory)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await readFile(source, 'utf8')).toBe('legacy media');
    await expect(readFile(destination)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(records.size).toBe(0);
  });

  it('refuses persisted undo outside the environment after a restart with narrower roots', async () => {
    const source = path.join(directory, 'Movie.2020.mkv');
    await writeFile(source, 'movie');
    const plan = await service.getPreview(directory);
    const renamed = await service.executeRename(plan.id);
    expect(renamed.outcomes[0].status).toBe('renamed');

    const authorized = path.join(directory, 'authorized');
    await mkdir(authorized);
    config = new ConfigService({ subsync: { mediaDirs: [authorized] } });
    service = new RenameService(settings, repository, config);
    const undone = await service.undo(renamed.batchId);

    expect(undone.outcomes[0].status).toBe('failed');
    expect(await readFile(plan.rows[0].proposedPath, 'utf8')).toBe('movie');
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect([...records.values()][0].state).toBe('renamed');
  });

  it('requires selected scope within environment siblings for preview, execution, and undo', async () => {
    const first = path.join(directory, 'first');
    const second = path.join(directory, 'second');
    await mkdir(first);
    await mkdir(second);
    config = new ConfigService({ subsync: { mediaDirs: [first, second] } });
    service = new RenameService(settings, repository, config);
    selectedRoots = [first];
    const source = path.join(second, 'Movie.2020.mkv');
    await writeFile(source, 'movie');

    await expect(service.getPreview(second)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await readFile(source, 'utf8')).toBe('movie');
    selectedRoots = [second];
    const plan = await service.getPreview(second);
    expect(plan.rows[0].status).toBe('safe');

    selectedRoots = [first];
    await expect(service.executeRename(plan.id)).rejects.toThrow();
    expect(await readFile(source, 'utf8')).toBe('movie');
    await expect(readFile(plan.rows[0].proposedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(records.size).toBe(0);

    selectedRoots = [second];
    const renamed = await service.executeRename(plan.id);
    expect(renamed.outcomes[0].status).toBe('renamed');
    expect(await readFile(plan.rows[0].proposedPath, 'utf8')).toBe('movie');
    selectedRoots = [first];
    expect((await service.undo(renamed.batchId)).outcomes[0].status).toBe(
      'failed',
    );
    expect(await readFile(plan.rows[0].proposedPath, 'utf8')).toBe('movie');
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });

    selectedRoots = [second];
    expect((await service.undo(renamed.batchId)).outcomes[0].status).toBe(
      'undone',
    );
    expect(await readFile(source, 'utf8')).toBe('movie');
    await expect(readFile(plan.rows[0].proposedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('groups all sidecar formats and preserves language and forced/SDH flags', async () => {
    const stem = 'Show.S01E01E02.1080p';
    for (const suffix of [
      '.mkv',
      '.en.forced.srt',
      '.pt-BR.sdh.ass',
      '.ja.ssa',
      '.fra.vtt',
    ])
      await writeFile(path.join(directory, `${stem}${suffix}`), suffix);
    const plan = await service.getPreview(directory);
    expect(plan.rows).toHaveLength(5);
    expect(new Set(plan.rows.map((row) => row.groupId)).size).toBe(1);
    expect(plan.rows.map((row) => path.basename(row.proposedPath))).toEqual(
      expect.arrayContaining([
        'Show - S01E01E02.mkv',
        'Show - S01E01E02.en.forced.srt',
        'Show - S01E01E02.pt-BR.sdh.ass',
        'Show - S01E01E02.ja.ssa',
        'Show - S01E01E02.fra.vtt',
      ]),
    );
    expect(
      plan.rows.every((row) => path.dirname(row.proposedPath) === directory),
    ).toBe(true);
  });
  it('rejects sibling-prefix roots and filename traversal edits', async () => {
    await expect(
      service.getPreview(path.dirname(directory)),
    ).rejects.toBeInstanceOf(BadRequestException);
    const sibling = `${directory}-outside`;
    await mkdir(sibling);
    try {
      await expect(service.getPreview(sibling)).rejects.toThrow();
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
    await writeFile(path.join(directory, 'Movie.2020.mkv'), 'movie');
    const plan = await service.getPreview(directory);
    await expect(
      service.revise(plan.id, [
        { id: plan.rows[0].id, filename: '../escape.mkv' },
      ]),
    ).rejects.toThrow();
    await expect(service.executeRename('made-up-plan-id')).rejects.toThrow();
    await expect(
      service.revise(plan.id, [{ id: 'foreign-row', filename: 'Escape.mkv' }]),
    ).rejects.toThrow();
  });
  it('requires explicit anime classification and makes season moves opt-in', async () => {
    await writeFile(path.join(directory, 'Anime - 123 [1080p].mkv'), 'anime');
    const anime = await service.getPreview(directory);
    expect(anime.rows[0].status).toBe('unclassified');
    await expect(service.executeRename(anime.id)).rejects.toThrow();
    const manual = await service.revise(anime.id, [
      {
        id: anime.rows[0].id,
        classification: {
          ...anime.rows[0].classification,
          confidence: 'manual',
        },
      },
    ]);
    expect(manual.rows[0].status).toBe('safe');
    await writeFile(path.join(directory, 'Show.S02E01.mkv'), 'show');
    const sameFolder = await service.getPreview(directory);
    expect(
      sameFolder.rows.find((row) => row.classification.kind === 'episode')
        ?.proposedPath,
    ).toBe(path.join(directory, 'Show - S02E01.mkv'));
    const folders = await service.getPreview(directory, undefined, true);
    expect(
      folders.rows.find((row) => row.classification.kind === 'episode')
        ?.proposedPath,
    ).toBe(path.join(directory, 'Season 02', 'Show - S02E01.mkv'));
  });
  it('propagates edited video stems to sidecars and persists deselection through revisions', async () => {
    await writeFile(path.join(directory, 'Show.S01E01.mkv'), 'video');
    await writeFile(
      path.join(directory, 'Show.S01E01.en.forced.srt'),
      'subtitle',
    );
    const plan = await service.getPreview(directory);
    const video = plan.rows.find((row) => !row.sidecar)!;
    const sidecar = plan.rows.find((row) => row.sidecar)!;
    const edited = await service.revise(plan.id, [
      { id: video.id, filename: 'Chosen.mkv' },
      { id: sidecar.id, selected: false },
    ]);
    const again = await service.revise(edited.id, []);
    expect(again.rows.find((row) => row.id === video.id)?.proposedPath).toBe(
      path.join(directory, 'Chosen.mkv'),
    );
    expect(again.rows.find((row) => row.id === sidecar.id)).toMatchObject({
      selected: false,
      status: 'unchanged',
    });
    const reselected = await service.revise(again.id, [
      { id: sidecar.id, selected: true },
    ]);
    expect(
      reselected.rows.find((row) => row.id === sidecar.id)?.proposedPath,
    ).toBe(path.join(directory, 'Chosen.en.forced.srt'));
  });
  it('revalidates identities and collisions immediately before executing', async () => {
    const source = path.join(directory, 'Movie.2020.mkv');
    await writeFile(source, 'original');
    const plan = await service.getPreview(directory);
    await service.dryRun(plan.id);
    await writeFile(plan.rows[0].proposedPath, 'race winner');
    await expect(service.executeRename(plan.id)).rejects.toThrow();
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(plan.rows[0].proposedPath, 'utf8')).toBe(
      'race winner',
    );
    await rm(plan.rows[0].proposedPath);
    await writeFile(source, 'changed content');
    await expect(service.executeRename(plan.id)).rejects.toThrow();
  });
  it('detects duplicate destinations before moving any file', async () => {
    await writeFile(path.join(directory, 'Movie.2020.mkv'), 'one');
    await writeFile(path.join(directory, 'Other.2020.mkv'), 'two');
    const plan = await service.getPreview(directory);
    const revised = await service.revise(
      plan.id,
      plan.rows.map((row) => ({ id: row.id, filename: 'Shared.mkv' })),
    );
    expect(revised.rows.every((row) => row.status === 'conflict')).toBe(true);
    await expect(service.executeRename(revised.id)).rejects.toThrow();
    expect(records.size).toBe(0);
  });
  it('persists undo across service recreation and refuses to overwrite an original name', async () => {
    const source = path.join(directory, 'Movie.2020.mkv');
    await writeFile(source, 'movie');
    const plan = await service.getPreview(directory);
    const renamed = await service.executeRename(plan.id);
    expect(renamed.outcomes[0].status).toBe('renamed');
    await expect(service.executeRename(plan.id)).rejects.toThrow();
    service = new RenameService(settings, repository, config);
    await writeFile(source, 'new original');
    const blocked = await service.undo(renamed.batchId);
    expect(blocked.outcomes[0].status).toBe('failed');
    expect(await readFile(source, 'utf8')).toBe('new original');
    expect(await readFile(plan.rows[0].proposedPath, 'utf8')).toBe('movie');
    await rm(source);
    const undone = await service.undo(renamed.batchId);
    expect(undone.outcomes[0].status).toBe('undone');
    expect(await readFile(source, 'utf8')).toBe('movie');
    expect([...records.values()][0].state).toBe('undone');
  });
  it('does not undo a destination whose content changed', async () => {
    await writeFile(path.join(directory, 'Movie.2020.mkv'), 'movie');
    const plan = await service.getPreview(directory);
    const result = await service.executeRename(plan.id);
    await writeFile(plan.rows[0].proposedPath, 'edited movie');
    expect((await service.undo(result.batchId)).outcomes[0].status).toBe(
      'failed',
    );
    expect(await readFile(plan.rows[0].proposedPath, 'utf8')).toBe(
      'edited movie',
    );
  });
  it('recovers a journaled crash with both hardlink names still present', async () => {
    const source = path.join(directory, 'Movie.2020.mkv');
    await writeFile(source, 'movie');
    const plan = await service.getPreview(directory);
    const result = await service.executeRename(plan.id);
    await link(plan.rows[0].proposedPath, source);
    const entry = [...records.values()][0];
    entry.state = 'pending';
    records.set(entry.id, entry);
    service = new RenameService(settings, repository, config);
    expect((await service.undo(result.batchId)).outcomes[0].status).toBe(
      'undone',
    );
    expect(await readFile(source, 'utf8')).toBe('movie');
    await expect(readFile(plan.rows[0].proposedPath)).rejects.toThrow();
  });
  it('reports inaccessible roots instead of an empty successful preview', async () => {
    const missing = path.join(directory, 'missing');
    await expect(service.getPreview(missing)).rejects.toThrow();
    await mkdir(missing);
    expect((await service.getPreview(missing)).rows).toEqual([]);
  });
  it('isolates a malformed classification to its group and permits deselecting it', async () => {
    await writeFile(path.join(directory, 'Valid.2020.mkv'), 'valid');
    await writeFile(path.join(directory, 'Mystery.mkv'), 'mystery');
    await writeFile(path.join(directory, 'Mystery.eng.forced.srt'), 'subtitle');
    const original = await service.getPreview(directory);
    const unknown = original.rows.find(
      (row) => !row.sidecar && row.classification.kind === 'unknown',
    )!;
    const invalid = await service.revise(original.id, [
      {
        id: unknown.id,
        classification: {
          kind: 'movie',
          title: 'Missing year',
          confidence: 'manual',
        },
      },
    ]);
    expect(
      invalid.rows
        .filter((row) => row.groupId === unknown.groupId)
        .every((row) => row.status === 'conflict'),
    ).toBe(true);
    expect(
      invalid.rows.find((row) => row.classification.title === 'Valid')?.status,
    ).toBe('safe');
    expect(
      (await service.dryRun(invalid.id)).rows.find(
        (row) => row.id === unknown.id,
      )?.status,
    ).toBe('conflict');
    const deselected = await service.revise(
      invalid.id,
      invalid.rows
        .filter((row) => row.groupId === unknown.groupId)
        .map((row) => ({ id: row.id, selected: false })),
    );
    expect(
      deselected.rows
        .filter((row) => row.groupId === unknown.groupId)
        .every((row) => row.status === 'unchanged'),
    ).toBe(true);
    expect(
      (await service.executeRename(deselected.id)).outcomes.filter(
        (row) => row.status === 'renamed',
      ),
    ).toHaveLength(1);
  });
  it('sanitizes selected real metadata punctuation while keeping subtitle suffixes intact', async () => {
    await writeFile(path.join(directory, 'Spider.Man.2021.mkv'), 'video');
    await writeFile(
      path.join(directory, 'Spider.Man.2021.eng.forced.srt'),
      'subtitle',
    );
    const plan = await service.getPreview(directory);
    const video = plan.rows.find((row) => !row.sidecar)!;
    const revised = await service.revise(plan.id, [
      {
        id: video.id,
        classification: {
          kind: 'movie',
          title: 'Spider-Man: No Way Home',
          year: 2021,
          confidence: 'manual',
        },
      },
    ]);
    expect(revised.rows.map((row) => path.basename(row.proposedPath))).toEqual(
      expect.arrayContaining([
        'Spider-Man - No Way Home (2021).mkv',
        'Spider-Man - No Way Home (2021).eng.forced.srt',
      ]),
    );
    expect(revised.rows.every((row) => row.status === 'safe')).toBe(true);
  });
  it('retires replaced server plans and supports more than 100 successive edits', async () => {
    await writeFile(path.join(directory, 'Movie.2020.mkv'), 'movie');
    let current = await service.getPreview(directory);
    const retired = current.id;
    for (let index = 0; index < 120; index++)
      current = await service.revise(current.id, [
        { id: current.rows[0].id, filename: `Revision ${index}.mkv` },
      ]);
    await expect(service.executeRename(retired)).rejects.toThrow();
    await expect(service.revise(retired, [])).rejects.toThrow();
    expect((await service.dryRun(current.id)).rows[0].status).toBe('safe');
    expect(await readFile(current.rows[0].originalPath, 'utf8')).toBe('movie');
  });
  it('returns a conflict for one unrenderable preview group without hiding valid files', async () => {
    await writeFile(path.join(directory, '....mkv'), 'unusable title');
    await writeFile(path.join(directory, 'Valid.2020.mkv'), 'valid');
    const plan = await service.getPreview(directory);
    expect(plan.rows).toHaveLength(2);
    expect(
      plan.rows.find((row) => path.basename(row.originalPath) === '....mkv')
        ?.status,
    ).toBe('conflict');
    expect(
      plan.rows.find((row) => row.classification.title === 'Valid')?.status,
    ).toBe('safe');
  });
  it('permits only one concurrent replacement of a server-issued plan', async () => {
    await writeFile(path.join(directory, 'Movie.2020.mkv'), 'movie');
    const plan = await service.getPreview(directory);
    const replacements = await Promise.allSettled([
      service.revise(plan.id, []),
      service.revise(plan.id, []),
    ]);
    expect(
      replacements.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      replacements.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(service.executeRename(plan.id)).rejects.toThrow();
  });
});
