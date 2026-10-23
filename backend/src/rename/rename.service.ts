import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Repository } from 'typeorm';
import { assertWithinMediaRoots } from '../common/path-safety';
import { RenameJournalEntity } from '../database/entities/rename-journal.entity';
import { SettingsService } from '../settings/settings.service';
import {
  DEFAULT_RENAME_TEMPLATES,
  parseRenameName,
  renderRenameTemplate,
  safeRenameFilename,
} from './rename-names';
import type {
  RenameBatchResult,
  RenameClassification,
  RenamePlan,
  RenamePlanRow,
  RenameTemplates,
} from './rename.types';

interface StoredPlan {
  plan: RenamePlan;
  identities: Map<string, string>;
  renderErrors: Map<string, string>;
}
export interface RenamePlanEdit {
  id: string;
  filename?: string;
  classification?: RenameClassification;
  selected?: boolean;
}
const VIDEO: Record<string, true> = {
  '.mkv': true,
  '.mp4': true,
  '.avi': true,
  '.mov': true,
  '.m4v': true,
  '.webm': true,
  '.ts': true,
};
const SUBTITLE: Record<string, true> = {
  '.srt': true,
  '.ass': true,
  '.ssa': true,
  '.vtt': true,
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
@Injectable()
export class RenameService {
  private readonly plans = new Map<string, StoredPlan>();
  private busy = false;
  constructor(
    private readonly settings: SettingsService,
    @InjectRepository(RenameJournalEntity)
    private readonly journal: Repository<RenameJournalEntity>,
    private readonly config: ConfigService,
  ) {}
  private async roots(): Promise<string[]> {
    return (await this.settings.getSettings()).mediaDirs;
  }
  private async assertMediaPath(
    candidate: string,
    roots: string[],
    options?: { allowMissing?: boolean },
  ): Promise<string> {
    try {
      await assertWithinMediaRoots(
        candidate,
        this.config.get<string[]>('subsync.mediaDirs', []),
        options,
      );
      return await assertWithinMediaRoots(candidate, roots, options);
    } catch (error) {
      throw new BadRequestException(
        `Media path is unavailable or outside configured roots: ${message(error)}`,
      );
    }
  }
  private async identity(file: string): Promise<string> {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new BadRequestException(
        'Source must be a regular file (no symlinks)',
      );
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.birthtimeMs}`;
  }
  private async exists(file: string): Promise<boolean> {
    try {
      await fs.lstat(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  private store(
    plan: RenamePlan,
    identities: Map<string, string>,
    renderErrors: Map<string, string>,
    replacedId?: string,
  ): RenamePlan {
    const stored = { plan: structuredClone(plan), identities, renderErrors };
    for (const [id, entry] of this.plans)
      if (Date.parse(entry.plan.expiresAt) < Date.now()) this.plans.delete(id);
    if (replacedId && !this.plans.has(replacedId))
      throw new ConflictException(
        'Plan was replaced or executed. Use the latest preview.',
      );
    if (this.plans.size - (replacedId ? 1 : 0) >= 100)
      throw new ConflictException(
        'Too many open plans; wait for an existing plan to expire',
      );
    this.plans.set(plan.id, stored);
    if (replacedId) this.plans.delete(replacedId);
    return plan;
  }
  private get(id: string): StoredPlan {
    const stored = this.plans.get(id);
    if (!stored || Date.parse(stored.plan.expiresAt) < Date.now())
      throw new NotFoundException('Plan expired or unknown. Preview again.');
    return stored;
  }
  async getPreview(
    directory: string,
    templates = DEFAULT_RENAME_TEMPLATES,
    seasonFolders = false,
  ): Promise<RenamePlan> {
    const roots = await this.roots();
    const base = await this.assertMediaPath(directory, roots);
    if (!(await fs.stat(base)).isDirectory())
      throw new BadRequestException('Choose a directory');
    const plan: RenamePlan = {
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      directory: base,
      templates,
      seasonFolders,
      rows: [],
    };
    const identities = new Map<string, string>();
    const walk = async (directoryPath: string): Promise<void> => {
      await this.assertMediaPath(directoryPath, roots);
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const videos = entries.filter(
        (entry) =>
          entry.isFile() && VIDEO[path.extname(entry.name).toLowerCase()],
      );
      for (const video of videos) {
        const extension = path.extname(video.name);
        const stem = path.basename(video.name, extension);
        const season = path.basename(directoryPath).match(/^Season\s*(\d+)$/i);
        const folderTitle = season
          ? path.basename(path.dirname(directoryPath))
          : path.basename(directoryPath);
        const classification = parseRenameName(
          stem,
          folderTitle,
          season ? Number(season[1]) : 1,
        );
        const groupId = randomUUID();
        const files = [
          video,
          ...entries.filter(
            (entry) =>
              entry.isFile() &&
              SUBTITLE[path.extname(entry.name).toLowerCase()] &&
              (path.basename(entry.name, path.extname(entry.name)) === stem ||
                path
                  .basename(entry.name, path.extname(entry.name))
                  .startsWith(`${stem}.`)) &&
              !videos.some(
                (other) =>
                  other.name !== video.name &&
                  path
                    .basename(other.name, path.extname(other.name))
                    .startsWith(`${stem}.`) &&
                  entry.name.startsWith(
                    `${path.basename(other.name, path.extname(other.name))}.`,
                  ),
              ),
          ),
        ];
        for (const file of files) {
          if (plan.rows.length >= 5000)
            throw new BadRequestException(
              'Folder exceeds 5000 files; preview a smaller directory',
            );
          const originalPath = path.join(directoryPath, file.name);
          await this.assertMediaPath(originalPath, roots);
          const id = randomUUID();
          identities.set(id, await this.identity(originalPath));
          plan.rows.push({
            id,
            groupId,
            originalPath,
            proposedPath: originalPath,
            sidecar: file !== video,
            selected: true,
            classification: { ...classification },
            status: 'unchanged',
          });
        }
      }
      for (const entry of entries)
        if (entry.isDirectory())
          await walk(path.join(directoryPath, entry.name));
    };
    await walk(base);
    const renderErrors = this.renderGroups(plan);
    await this.validate(plan, identities, renderErrors);
    return this.store(plan, identities, renderErrors);
  }
  private renderGroups(plan: RenamePlan): Map<string, string> {
    const errors = new Map<string, string>();
    const groups = new Map<string, RenamePlanRow[]>();
    for (const row of plan.rows) {
      const group = groups.get(row.groupId);
      if (group) group.push(row);
      else groups.set(row.groupId, [row]);
    }
    for (const rows of groups.values()) {
      const video = rows.find((row) => !row.sidecar)!;
      for (const row of rows) {
        row.proposedPath = row.originalPath;
        row.classification = { ...video.classification };
      }
      if (!rows.some((row) => row.selected)) continue;
      try {
        const classification = video.classification;
        const stem = path.basename(
          video.originalPath,
          path.extname(video.originalPath),
        );
        let directory = path.dirname(video.originalPath);
        if (plan.seasonFolders && classification.kind === 'episode') {
          const parent = /^Season\s*\d+$/i.test(path.basename(directory))
            ? path.dirname(directory)
            : directory;
          directory = path.join(
            parent,
            `Season ${String(classification.season ?? 1).padStart(2, '0')}`,
          );
        }
        const name = video.customFilename
          ? path.basename(
              video.customFilename,
              path.extname(video.customFilename),
            )
          : renderRenameTemplate(classification, plan.templates);
        for (const row of rows) {
          if (!row.selected) continue;
          const suffix = path.basename(row.originalPath).slice(stem.length);
          row.proposedPath = path.join(
            directory,
            safeRenameFilename(row.customFilename ?? `${name}${suffix}`),
          );
        }
      } catch (error) {
        for (const row of rows) {
          row.proposedPath = row.originalPath;
          if (row.selected) errors.set(row.id, message(error));
        }
      }
    }
    return errors;
  }
  async revise(
    id: string,
    edits: RenamePlanEdit[],
    templates?: RenameTemplates,
  ): Promise<RenamePlan> {
    const previous = this.get(id);
    const plan = structuredClone(previous.plan);
    if (templates) plan.templates = templates;
    const seen = new Set<string>();
    for (const edit of edits) {
      if (seen.has(edit.id))
        throw new BadRequestException('Duplicate row edit');
      seen.add(edit.id);
      const row = plan.rows.find((entry) => entry.id === edit.id);
      if (!row)
        throw new BadRequestException('Row is not part of this server plan');
      if (edit.selected !== undefined) row.selected = edit.selected;
      if (edit.filename !== undefined) {
        safeRenameFilename(edit.filename);
        if (
          path.extname(edit.filename).toLowerCase() !==
          path.extname(row.originalPath).toLowerCase()
        )
          throw new BadRequestException('Keep the original file extension');
        row.customFilename = edit.filename;
      }
      if (edit.classification) {
        if (row.sidecar)
          throw new BadRequestException('Classify the video, not a sidecar');
        row.classification = { ...edit.classification, confidence: 'manual' };
      }
    }
    const renderErrors = this.renderGroups(plan);
    plan.id = randomUUID();
    plan.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    await this.validate(plan, previous.identities, renderErrors);
    return this.store(plan, new Map(previous.identities), renderErrors, id);
  }
  private async validate(
    plan: RenamePlan,
    identities: Map<string, string>,
    renderErrors: Map<string, string>,
  ): Promise<void> {
    const roots = await this.roots();
    const targets = new Map<string, number>();
    const key = (file: string) =>
      process.platform === 'win32' ? file.toLowerCase() : file;
    for (const row of plan.rows)
      targets.set(
        key(row.proposedPath),
        (targets.get(key(row.proposedPath)) ?? 0) + 1,
      );
    for (const row of plan.rows) {
      row.reason = undefined;
      row.status = row.originalPath === row.proposedPath ? 'unchanged' : 'safe';
      if (!row.selected) {
        row.status = 'unchanged';
        row.reason = 'Not selected';
        continue;
      }
      const renderError = renderErrors.get(row.id);
      if (renderError) {
        row.status = 'conflict';
        row.reason = renderError;
        continue;
      }
      try {
        await this.assertMediaPath(row.originalPath, roots);
        await this.assertMediaPath(row.proposedPath, roots, {
          allowMissing: true,
        });
        if ((await this.identity(row.originalPath)) !== identities.get(row.id))
          throw new Error('Source changed since preview');
        if (row.status === 'unchanged') continue;
        if (
          row.classification.kind === 'unknown' ||
          row.classification.confidence === 'low'
        ) {
          row.status = 'unclassified';
          row.reason = 'Confirm a manual classification before renaming';
          continue;
        }
        if ((targets.get(key(row.proposedPath)) ?? 0) > 1)
          throw new Error('Duplicate destination in plan');
        if (await this.exists(row.proposedPath))
          throw new Error(
            'Destination exists (cycles and case-only renames are not supported)',
          );
      } catch (error) {
        row.status = 'conflict';
        row.reason = message(error);
      }
    }
  }
  async dryRun(id: string): Promise<RenamePlan> {
    const stored = this.get(id);
    await this.validate(stored.plan, stored.identities, stored.renderErrors);
    return structuredClone(stored.plan);
  }
  async executeRename(id: string): Promise<RenameBatchResult> {
    if (this.busy)
      throw new ConflictException('Another rename or undo is running');
    this.busy = true;
    try {
      const stored = this.get(id);
      await this.validate(stored.plan, stored.identities, stored.renderErrors);
      if (this.get(id) !== stored)
        throw new ConflictException(
          'Plan was replaced. Use the latest preview.',
        );
      const rows = stored.plan.rows;
      if (
        rows.some(
          (row) => row.status === 'conflict' || row.status === 'unclassified',
        )
      )
        throw new ConflictException({
          message: 'Plan has conflicts; review the final dry run',
          plan: stored.plan,
        });
      this.plans.delete(id);
      const batchId = randomUUID();
      const outcomes: RenameBatchResult['outcomes'] = [];
      for (const row of rows) {
        if (row.status === 'unchanged') {
          outcomes.push({ ...row, status: 'unchanged' });
          continue;
        }
        const entry = this.journal.create({
          id: randomUUID(),
          batchId,
          originalPath: row.originalPath,
          destinationPath: row.proposedPath,
          identity: stored.identities.get(row.id)!,
          state: 'pending',
          error: null,
          createdAt: new Date().toISOString(),
        });
        await this.journal.save(entry);
        try {
          await this.moveNoReplace(
            row.originalPath,
            row.proposedPath,
            entry.identity,
          );
          entry.state = 'renamed';
          await this.journal.save(entry);
          outcomes.push({ ...row, status: 'renamed' });
        } catch (error) {
          entry.state = 'failed';
          entry.error = message(error);
          await this.journal.save(entry);
          outcomes.push({ ...row, status: 'failed', reason: entry.error });
        }
      }
      return { batchId, outcomes };
    } finally {
      this.busy = false;
    }
  }
  private async moveNoReplace(
    source: string,
    destination: string,
    identity: string,
  ): Promise<void> {
    const roots = await this.roots();
    await this.assertMediaPath(source, roots);
    await this.assertMediaPath(destination, roots, { allowMissing: true });
    if ((await this.identity(source)) !== identity)
      throw new ConflictException('File identity changed');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await this.assertMediaPath(destination, roots, { allowMissing: true });
    // link is atomic and fails EEXIST: unlike rename(), it cannot overwrite a race winner.
    // Cross-device/unsupported hardlinks fail safely; never fall back to overwriting rename.
    try {
      await fs.link(source, destination);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
      ) {
        if (error.code === 'EXDEV')
          throw new ConflictException(
            'Cross-device moves are unsupported; original file was left untouched. Choose a folder on the same filesystem.',
          );
        if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EACCES'].includes(error.code))
          throw new ConflictException(
            'This filesystem or its permissions do not support safe hardlink moves; original file was left untouched.',
          );
        if (error.code === 'EEXIST')
          throw new ConflictException(
            'Destination appeared during execution; no file was overwritten and the original was left untouched.',
          );
      }
      throw error;
    }
    if (
      (await this.identity(source)) !== identity ||
      (await this.identity(destination)) !== identity
    )
      throw new ConflictException(
        'File changed while linking; both names retained for recovery',
      );
    await fs.unlink(source);
  }
  async history(): Promise<RenameJournalEntity[]> {
    return this.journal.find({
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 1000,
    });
  }
  async undo(batchId: string): Promise<RenameBatchResult> {
    if (this.busy)
      throw new ConflictException('Another rename or undo is running');
    this.busy = true;
    try {
      const entries = await this.journal.find({
        where: { batchId },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      if (!entries.length)
        throw new NotFoundException('Rename batch not found');
      const outcomes: RenameBatchResult['outcomes'] = [];
      for (const entry of entries) {
        if (entry.state === 'undone') {
          outcomes.push({
            id: entry.id,
            originalPath: entry.destinationPath,
            proposedPath: entry.originalPath,
            status: 'unchanged',
          });
          continue;
        }
        try {
          // Recover crashes before unlink, after unlink, or after a previous undo's filesystem step.
          const roots = await this.roots();
          await this.assertMediaPath(entry.originalPath, roots, {
            allowMissing: true,
          });
          await this.assertMediaPath(entry.destinationPath, roots, {
            allowMissing: true,
          });
          if (await this.exists(entry.originalPath)) {
            if ((await this.identity(entry.originalPath)) !== entry.identity)
              throw new ConflictException(
                'Original destination exists with a different identity',
              );
            if (await this.exists(entry.destinationPath)) {
              if (
                (await this.identity(entry.destinationPath)) !== entry.identity
              )
                throw new ConflictException('Renamed file identity changed');
              await fs.unlink(entry.destinationPath);
            }
          } else {
            await this.moveNoReplace(
              entry.destinationPath,
              entry.originalPath,
              entry.identity,
            );
          }
          entry.state = 'undone';
          entry.error = null;
          await this.journal.save(entry);
          outcomes.push({
            id: entry.id,
            originalPath: entry.destinationPath,
            proposedPath: entry.originalPath,
            status: 'undone',
          });
        } catch (error) {
          entry.error = message(error);
          await this.journal.save(entry);
          outcomes.push({
            id: entry.id,
            originalPath: entry.destinationPath,
            proposedPath: entry.originalPath,
            status: 'failed',
            reason: entry.error,
          });
        }
      }
      return { batchId, outcomes };
    } finally {
      this.busy = false;
    }
  }
}
