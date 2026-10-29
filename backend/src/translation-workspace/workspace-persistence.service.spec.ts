import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WorkspaceCheckpointEntity } from '../database/entities/workspace-checkpoint.entity';
import { WorkspaceMemoryEntity } from '../database/entities/workspace-memory.entity';
import { AddTranslationWorkspace1738700000008 } from '../migrations/1738700000008-AddTranslationWorkspace';
import {
  WorkspacePersistenceService,
  type WorkspaceMemoryApproval,
} from './workspace-persistence.service';

const approval: WorkspaceMemoryApproval = {
  source: 'Hello',
  target: 'Hola',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  contextHash: 'neighbors',
  signature: 'glossary-and-style',
  approved: true,
  model: 'test-model',
  provenance: 'manual editor approval',
};

describe('WorkspacePersistenceService', () => {
  let database: DataSource;
  let service: WorkspacePersistenceService;

  beforeEach(async () => {
    database = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [WorkspaceCheckpointEntity, WorkspaceMemoryEntity],
      migrations: [AddTranslationWorkspace1738700000008],
      migrationsRun: true,
    });
    await database.initialize();
    service = new WorkspacePersistenceService(database);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (database.isInitialized) await database.destroy();
  });

  it('resumes validated chunks and context across service instances without losing concurrent chunks', async () => {
    const opened = await service.open('document-and-settings-hash');
    expect(opened).toEqual({
      key: expect.any(String) as unknown as string,
      translations: {},
      contextSheet: null,
    });
    await Promise.all([
      service.saveChunk(opened.key, [0, 3], ['Hola', 'Adiós']),
      service.saveChunk(opened.key, [1], ['¿Qué tal?']),
      service.saveContext(opened.key, 'Two friends meet.'),
    ]);
    const restarted = new WorkspacePersistenceService(database);
    expect(await restarted.open('document-and-settings-hash')).toEqual({
      key: opened.key,
      translations: { 0: 'Hola', 1: '¿Qué tal?', 3: 'Adiós' },
      contextSheet: 'Two friends meet.',
    });
    await restarted.saveChunk(opened.key, [3], ['Hasta luego']);
    expect(
      (await restarted.load(opened.key, 'document-and-settings-hash'))
        ?.translations[3],
    ).toBe('Hasta luego');
  });

  it('rejects mismatched identities and keeps the original checkpoint unchanged', async () => {
    await service.open('original', 'explicit-key');
    await service.saveChunk('explicit-key', [0], ['original translation']);
    await expect(
      service.open('changed-model', 'explicit-key'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.load('explicit-key', 'changed-glossary'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await service.load('explicit-key', 'original'))?.translations,
    ).toEqual({ 0: 'original translation' });
    expect(await service.load('missing', 'original')).toBeNull();
  });

  it('expires checkpoints at thirty days and retains at most one hundred newest active entries', async () => {
    let now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.open('old', 'old');
    now += 30 * 24 * 60 * 60 * 1000;
    expect(await service.load('old', 'old')).toBeNull();
    for (let index = 0; index < 101; index++) {
      now++;
      await service.open(`identity-${index}`, `key-${index}`);
    }
    expect(
      await database.getRepository(WorkspaceCheckpointEntity).count(),
    ).toBe(100);
    expect(await service.load('key-0', 'identity-0')).toBeNull();
    expect(await service.load('key-100', 'identity-100')).not.toBeNull();
  });

  it('validates chunk shape atomically and does not create checkpoints during saves', async () => {
    const { key } = await service.open('document');
    expect(() => service.saveChunk(key, [0, 1], ['one'])).toThrow(
      BadRequestException,
    );
    expect(() => service.saveChunk(key, [-1], ['one'])).toThrow(
      BadRequestException,
    );
    expect(() => service.saveChunk(key, [0, 0], ['one', 'two'])).toThrow(
      BadRequestException,
    );
    expect(() => service.saveChunk(key, [0], ['x'.repeat(48_001)])).toThrow(
      BadRequestException,
    );
    expect(() => service.saveContext(key, 'x'.repeat(12_001))).toThrow(
      BadRequestException,
    );
    expect((await service.load(key, 'document'))?.translations).toEqual({});
    await expect(
      service.saveChunk('missing', [0], ['one']),
    ).rejects.toBeInstanceOf(NotFoundException);
    // A failed transaction must not poison subsequent operations.
    await service.saveChunk(key, [0], ['valid']);
    expect((await service.load(key, 'document'))?.translations).toEqual({
      0: 'valid',
    });
  });

  it('never automatically populates memory from checkpoints or context', async () => {
    const { key } = await service.open('document');
    await service.saveChunk(key, [0], ['Hola']);
    await service.saveContext(key, 'Story');
    expect(await service.listMemory()).toEqual({ entries: [], total: 0 });
    expect(await service.lookup(approval)).toBeNull();
  });

  it('requires manual approval and matches every source, context, language and signature field exactly', async () => {
    expect(() =>
      service.approve({
        ...approval,
        approved: false,
      } as unknown as WorkspaceMemoryApproval),
    ).toThrow(BadRequestException);
    const entry = await service.approve(approval);
    expect(await service.lookup(approval)).toEqual(entry);
    for (const change of [
      { source: 'hello' },
      { source: 'Hello ' },
      { contextHash: 'other-neighbors' },
      { sourceLanguage: 'fr' },
      { targetLanguage: 'pt' },
      { signature: 'changed-style' },
    ]) {
      expect(await service.lookup({ ...approval, ...change })).toBeNull();
    }
    const updated = await service.approve({
      ...approval,
      target: 'Buenos días',
    });
    expect(updated.id).toBe(entry.id);
    expect(updated.createdAt).toBe(entry.createdAt);
    expect((await service.listMemory()).total).toBe(1);
    expect((await service.lookup(approval))?.target).toBe('Buenos días');
  });

  it('treats SQL-like source text as literal data and supports paginated deletion', async () => {
    const literal = {
      ...approval,
      source: "'; DROP TABLE workspace_memory; --",
    };
    const entry = await service.approve(literal);
    expect((await service.lookup(literal))?.id).toBe(entry.id);
    await service.approve(approval);
    expect(await service.listMemory(0, 1)).toEqual({
      entries: [expect.any(WorkspaceMemoryEntity)],
      total: 2,
    });
    expect((await service.listMemory(1, 1)).entries).toHaveLength(1);
    await service.deleteMemory(entry.id);
    expect(await service.lookup(literal)).toBeNull();
    await expect(service.deleteMemory(entry.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(() => service.listMemory(-1)).toThrow(BadRequestException);
    expect(() => service.listMemory(0, 101)).toThrow(BadRequestException);
  });

  it('retains at most ten thousand approved memory entries without evicting the just-approved entry', async () => {
    const repository = database.getRepository(WorkspaceMemoryEntity);
    const now = Date.now();
    for (let offset = 0; offset < 10_000; offset += 100) {
      await repository.insert(
        Array.from({ length: 100 }, (_, index) => ({
          ...approval,
          id: `seed-${offset + index}`,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    const fresh = await service.approve(approval);
    expect(await repository.count()).toBe(10_000);
    expect((await service.lookup(approval))?.id).toBe(fresh.id);
  });

  it('lists only checkpoint metadata, paginates and deletes explicitly', async () => {
    const { key } = await service.open('private-document-identity');
    await service.saveChunk(key, [0, 1], ['private one', 'private two']);
    await service.saveContext(key, 'private story');
    expect(await service.listCheckpoints(0, 1)).toEqual({
      entries: [
        {
          key,
          createdAt: expect.any(Number) as unknown as number,
          updatedAt: expect.any(Number) as unknown as number,
          translatedCues: 2,
          hasContext: true,
        },
      ],
      total: 1,
    });
    expect((await service.listCheckpoints(1, 1)).entries).toEqual([]);
    expect(() => service.listCheckpoints(0, 101)).toThrow(BadRequestException);
    await service.deleteCheckpoint(key);
    expect(await service.load(key, 'private-document-identity')).toBeNull();
    await expect(service.deleteCheckpoint(key)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
