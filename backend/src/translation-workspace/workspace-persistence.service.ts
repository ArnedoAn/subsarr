import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { WorkspaceCheckpointEntity } from '../database/entities/workspace-checkpoint.entity';
import { WorkspaceMemoryEntity } from '../database/entities/workspace-memory.entity';

const CHECKPOINT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CHECKPOINTS = 100;
const MAX_MEMORY = 10_000;
const MAX_CUE_LENGTH = 48_000;

export interface WorkspaceCheckpoint {
  key: string;
  translations: Record<number, string>;
  contextSheet: string | null;
}

export interface WorkspaceCheckpointMetadata {
  key: string;
  createdAt: number;
  updatedAt: number;
  translatedCues: number;
  hasContext: boolean;
}

export interface WorkspaceMemoryQuery {
  source: string;
  sourceLanguage: string;
  targetLanguage: string;
  contextHash: string;
  signature: string;
}

export interface WorkspaceMemoryApproval extends WorkspaceMemoryQuery {
  target: string;
  approved: true;
  model?: string;
  provenance?: string;
}

/** Callers must not invoke checkpoint methods for ephemeral translations. */
@Injectable()
export class WorkspacePersistenceService {
  // SQLite has one writer. Serialize read/modify/write operations, including
  // reads, so simultaneous chunk callbacks cannot replace one another's cues.
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly database: DataSource) {}

  open(identity: string, key?: string): Promise<WorkspaceCheckpoint> {
    this.validateText(identity, 'Checkpoint identity', 48_000);
    const checkpointKey = key ?? this.hash(identity);
    this.validateKey(checkpointKey);
    return this.run(async (manager) => {
      await this.pruneCheckpoints(manager);
      const repository = manager.getRepository(WorkspaceCheckpointEntity);
      let checkpoint = await repository.findOneBy({ id: checkpointKey });
      if (checkpoint) {
        this.assertIdentity(checkpoint, identity);
        checkpoint.updatedAt = Date.now();
      } else {
        const now = Date.now();
        checkpoint = repository.create({
          id: checkpointKey,
          identity,
          translationsJson: '{}',
          contextSheet: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      await repository.save(checkpoint);
      await this.trimCheckpoints(manager, checkpointKey);
      return this.snapshot(checkpoint);
    });
  }

  load(key: string, identity: string): Promise<WorkspaceCheckpoint | null> {
    this.validateKey(key);
    this.validateText(identity, 'Checkpoint identity', 48_000);
    return this.run(async (manager) => {
      await this.pruneCheckpoints(manager);
      const repository = manager.getRepository(WorkspaceCheckpointEntity);
      const checkpoint = await repository.findOneBy({ id: key });
      if (!checkpoint) return null;
      this.assertIdentity(checkpoint, identity);
      checkpoint.updatedAt = Date.now();
      await repository.save(checkpoint);
      return this.snapshot(checkpoint);
    });
  }

  saveChunk(key: string, indices: number[], lines: string[]): Promise<void> {
    this.validateKey(key);
    if (
      indices.length !== lines.length ||
      indices.some((index) => !Number.isSafeInteger(index) || index < 0) ||
      new Set(indices).size !== indices.length
    ) {
      throw new BadRequestException(
        'Checkpoint chunk indices must be unique nonnegative integers matching its lines',
      );
    }
    for (const line of lines)
      this.validateText(line, 'Translation', MAX_CUE_LENGTH, true);
    return this.run(async (manager) => {
      const checkpoint = await this.requireCheckpoint(manager, key);
      const translations = this.snapshot(checkpoint).translations;
      indices.forEach((index, offset) => {
        translations[index] = lines[offset];
      });
      checkpoint.translationsJson = JSON.stringify(translations);
      checkpoint.updatedAt = Date.now();
      await manager.getRepository(WorkspaceCheckpointEntity).save(checkpoint);
    });
  }

  saveContext(key: string, contextSheet: string): Promise<void> {
    this.validateKey(key);
    this.validateText(contextSheet, 'Context sheet', 12_000, true);
    return this.run(async (manager) => {
      const checkpoint = await this.requireCheckpoint(manager, key);
      checkpoint.contextSheet = contextSheet;
      checkpoint.updatedAt = Date.now();
      await manager.getRepository(WorkspaceCheckpointEntity).save(checkpoint);
    });
  }

  listCheckpoints(
    offset = 0,
    limit = 50,
  ): Promise<{ entries: WorkspaceCheckpointMetadata[]; total: number }> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException(
        'Checkpoint pagination requires offset >= 0 and limit between 1 and 100',
      );
    }
    return this.run(async (manager) => {
      await this.pruneCheckpoints(manager);
      const [rows, total] = await manager
        .getRepository(WorkspaceCheckpointEntity)
        .findAndCount({
          order: { updatedAt: 'DESC', id: 'DESC' },
          skip: offset,
          take: limit,
        });
      return {
        entries: rows.map((row) => ({
          key: row.id,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          translatedCues: Object.keys(this.snapshot(row).translations).length,
          hasContext: Boolean(row.contextSheet),
        })),
        total,
      };
    });
  }

  deleteCheckpoint(key: string): Promise<void> {
    this.validateKey(key);
    return this.run(async (manager) => {
      const result = await manager
        .getRepository(WorkspaceCheckpointEntity)
        .delete({ id: key });
      if (!result.affected)
        throw new NotFoundException('Translation checkpoint not found');
    });
  }

  lookup(query: WorkspaceMemoryQuery): Promise<WorkspaceMemoryEntity | null> {
    this.validateMemoryQuery(query);
    return this.run((manager) =>
      manager.getRepository(WorkspaceMemoryEntity).findOneBy({
        source: query.source,
        sourceLanguage: query.sourceLanguage,
        targetLanguage: query.targetLanguage,
        contextHash: query.contextHash,
        signature: query.signature,
        id: this.memoryId(query),
        approved: true,
      }),
    );
  }

  approve(input: WorkspaceMemoryApproval): Promise<WorkspaceMemoryEntity> {
    this.validateMemoryQuery(input);
    if (input.approved !== true) {
      throw new BadRequestException(
        'Translation memory requires explicit manual approval',
      );
    }
    this.validateText(input.target, 'Target', MAX_CUE_LENGTH);
    if (input.model !== undefined)
      this.validateText(input.model, 'Model', 128, true);
    if (input.provenance !== undefined)
      this.validateText(input.provenance, 'Provenance', 2_000, true);
    return this.run(async (manager) => {
      const repository = manager.getRepository(WorkspaceMemoryEntity);
      const id = this.memoryId(input);
      const existing = await repository.findOneBy({ id });
      const now = Date.now();
      const entry = repository.create({
        id,
        source: input.source,
        target: input.target,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        contextHash: input.contextHash,
        signature: input.signature,
        approved: true,
        model: input.model ?? null,
        provenance: input.provenance ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await repository.save(entry);
      const overflow = await repository
        .createQueryBuilder('memory')
        .select('memory.id')
        .where('memory.id != :id', { id })
        .orderBy('memory.updatedAt', 'DESC')
        .addOrderBy('memory.id', 'DESC')
        .offset(MAX_MEMORY - 1)
        .getMany();
      if (overflow.length)
        await repository.delete({ id: In(overflow.map((row) => row.id)) });
      return entry;
    });
  }

  listMemory(
    offset = 0,
    limit = 50,
  ): Promise<{ entries: WorkspaceMemoryEntity[]; total: number }> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException(
        'Memory pagination requires offset >= 0 and limit between 1 and 100',
      );
    }
    return this.run(async (manager) => {
      const [entries, total] = await manager
        .getRepository(WorkspaceMemoryEntity)
        .findAndCount({
          where: { approved: true },
          order: { updatedAt: 'DESC', id: 'DESC' },
          skip: offset,
          take: limit,
        });
      return { entries, total };
    });
  }

  deleteMemory(id: string): Promise<void> {
    this.validateText(id, 'Memory ID', 64);
    return this.run(async (manager) => {
      const result = await manager
        .getRepository(WorkspaceMemoryEntity)
        .delete({ id });
      if (!result.affected)
        throw new NotFoundException('Translation memory entry not found');
    });
  }

  private run<T>(
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const result = this.pending.then(() =>
      this.database.transaction(operation),
    );
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async pruneCheckpoints(manager: EntityManager): Promise<void> {
    await manager.getRepository(WorkspaceCheckpointEntity).delete({
      updatedAt: LessThanOrEqual(Date.now() - CHECKPOINT_TTL_MS),
    });
  }

  private async trimCheckpoints(
    manager: EntityManager,
    keep: string,
  ): Promise<void> {
    const repository = manager.getRepository(WorkspaceCheckpointEntity);
    const overflow = await repository
      .createQueryBuilder('checkpoint')
      .select('checkpoint.id')
      .where('checkpoint.id != :keep', { keep })
      .orderBy('checkpoint.updatedAt', 'DESC')
      .addOrderBy('checkpoint.id', 'DESC')
      .offset(MAX_CHECKPOINTS - 1)
      .getMany();
    if (overflow.length)
      await repository.delete({ id: In(overflow.map((row) => row.id)) });
  }

  private async requireCheckpoint(
    manager: EntityManager,
    key: string,
  ): Promise<WorkspaceCheckpointEntity> {
    await this.pruneCheckpoints(manager);
    const checkpoint = await manager
      .getRepository(WorkspaceCheckpointEntity)
      .findOneBy({ id: key });
    if (!checkpoint)
      throw new NotFoundException(
        'Translation checkpoint not found or expired',
      );
    return checkpoint;
  }

  private snapshot(checkpoint: WorkspaceCheckpointEntity): WorkspaceCheckpoint {
    const value: unknown = JSON.parse(checkpoint.translationsJson);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.entries(value).some(
        ([index, text]) =>
          !/^(0|[1-9]\d*)$/.test(index) ||
          !Number.isSafeInteger(Number(index)) ||
          typeof text !== 'string',
      )
    ) {
      throw new Error('Invalid stored translation checkpoint');
    }
    return {
      key: checkpoint.id,
      translations: value as Record<number, string>,
      contextSheet: checkpoint.contextSheet,
    };
  }

  private assertIdentity(
    checkpoint: WorkspaceCheckpointEntity,
    identity: string,
  ): void {
    if (checkpoint.identity !== identity) {
      throw new ConflictException(
        'Checkpoint does not match this document and translation configuration',
      );
    }
  }

  private validateKey(key: string): void {
    this.validateText(key, 'Checkpoint key', 128);
  }

  private validateMemoryQuery(query: WorkspaceMemoryQuery): void {
    this.validateText(query.source, 'Source', MAX_CUE_LENGTH);
    this.validateText(query.sourceLanguage, 'Source language', 64);
    this.validateText(query.targetLanguage, 'Target language', 64);
    this.validateText(query.contextHash, 'Context hash', 128);
    this.validateText(query.signature, 'Memory signature', 12_000);
  }

  private validateText(
    value: string,
    label: string,
    max: number,
    allowEmpty = false,
  ): void {
    if (
      typeof value !== 'string' ||
      (!allowEmpty && !value.length) ||
      value.length > max
    ) {
      throw new BadRequestException(
        `${label} must be ${allowEmpty ? '0' : '1'}-${max} characters`,
      );
    }
  }

  private memoryId(query: WorkspaceMemoryQuery): string {
    return this.hash(
      JSON.stringify([
        query.source,
        query.contextHash,
        query.sourceLanguage,
        query.targetLanguage,
        query.signature,
      ]),
    );
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
