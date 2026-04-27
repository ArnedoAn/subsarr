import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { SettingEntity } from './entities/setting.entity';
import { TokenUsageRowEntity } from './entities/token-usage-row.entity';
import { JobSnapshotEntity } from './entities/job-snapshot.entity';
import { JobLogRowEntity } from './entities/job-log.entity';
import {
  type RuleToggleConfig,
  type RuntimeSettings,
} from '../settings/settings.types';
import { runtimeToEntity } from '../settings/settings.mapper';
import { type ArchivedJobSnapshot } from '../jobs/job-archive.service';
import { type JobLogEntry } from '../jobs/job-logs.service';

const SETTINGS_ID = 'main';
const TOKEN_FILE = 'token-usage.json';
const ARCHIVE_FILE = 'jobs-archive.jsonl';

const DEFAULT_RULES: RuleToggleConfig[] = [
  { id: 'already-has-target-subtitle', enabled: true },
  { id: 'already-has-external-subtitle', enabled: true },
  { id: 'no-source-track', enabled: true },
  { id: 'image-based-subtitle', enabled: true },
  { id: 'file-too-large', enabled: false },
  { id: 'path-contains', enabled: true },
];

@Injectable()
export class LegacyImportService implements OnModuleInit {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      this.logger.error(
        `Legacy import failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private async run(): Promise<void> {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!config) {
      return;
    }

    const settingCount = await this.dataSource
      .getRepository(SettingEntity)
      .count({ where: { id: SETTINGS_ID } });

    if (settingCount === 0) {
      await this.importSettingsFromJsonIfPresent(config);
    }

    const tokenCount = await this.dataSource
      .getRepository(TokenUsageRowEntity)
      .count();
    if (tokenCount === 0) {
      await this.importTokenUsageFromJsonIfPresent(config.dataDir);
    }

    const snapCount = await this.dataSource
      .getRepository(JobSnapshotEntity)
      .count();
    if (snapCount === 0) {
      await this.importArchiveFromJsonlIfPresent(config.dataDir);
    }
  }

  private async importSettingsFromJsonIfPresent(
    config: SubsyncEnvConfig,
  ): Promise<void> {
    const p = config.settingsFilePath;
    let raw: string;
    try {
      raw = await fs.readFile(p, 'utf8');
    } catch {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
      const base: RuntimeSettings = {
        mediaDirs: parsed.mediaDirs ?? config.mediaDirs,
        sourceLanguage: (
          parsed.sourceLanguage ?? config.sourceLanguage
        ).toLowerCase(),
        targetLanguage: (
          parsed.targetLanguage ?? config.targetLanguage
        ).toLowerCase(),
        openRouterApiKey: parsed.openRouterApiKey ?? config.openRouterApiKey,
        deepSeekApiKey: parsed.deepSeekApiKey ?? config.deepSeekApiKey,
        scanCacheTtlMinutes:
          parsed.scanCacheTtlMinutes ?? config.scanCacheTtlMinutes,
        concurrency: parsed.concurrency ?? config.concurrency,
        pathContainsExclusions:
          parsed.pathContainsExclusions ?? config.pathExclusions,
        fileTooLargeBytes: parsed.fileTooLargeBytes ?? config.fileTooLargeBytes,
        translationVerificationEnabled:
          parsed.translationVerificationEnabled ?? false,
        rules: parsed.rules ?? DEFAULT_RULES,
        openRouterModel: parsed.openRouterModel ?? 'openrouter/free',
        deepSeekModel: parsed.deepSeekModel ?? 'deepseek-chat',
        autoScanEnabled: parsed.autoScanEnabled ?? false,
        autoScanCronExpression: parsed.autoScanCronExpression ?? '0 */6 * * *',
        autoTranslateNewItems: parsed.autoTranslateNewItems ?? false,
        telegramBotToken: parsed.telegramBotToken,
        telegramChatId: parsed.telegramChatId,
        telegramEnabled: parsed.telegramEnabled ?? false,
        telegramEvents: parsed.telegramEvents ?? [],
        dailyTokenLimitFree: parsed.dailyTokenLimitFree,
        dailyTokenLimitPaid: parsed.dailyTokenLimitPaid,
        monthlyBudgetUsd: parsed.monthlyBudgetUsd,
        jellyfinUrl: parsed.jellyfinUrl,
        jellyfinApiKey: parsed.jellyfinApiKey,
      };

      const row = runtimeToEntity(base);
      await this.dataSource.getRepository(SettingEntity).save(row);
      await fs.rename(p, `${p}.migrated.bak`);
      this.logger.log(`Migrated settings from JSON to SQLite: ${p}`);
    } catch (e) {
      this.logger.warn(
        `Could not migrate settings JSON: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private async importTokenUsageFromJsonIfPresent(
    dataDir: string,
  ): Promise<void> {
    const p = path.join(dataDir, TOKEN_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(p, 'utf8');
    } catch {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        free?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        paid?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
      };
      const repo = this.dataSource.getRepository(TokenUsageRowEntity);
      if (parsed.free) {
        await repo.save(
          repo.create({
            tier: 'free',
            date: 'legacy',
            promptTokens: parsed.free.promptTokens ?? 0,
            completionTokens: parsed.free.completionTokens ?? 0,
            totalTokens: parsed.free.totalTokens ?? 0,
          }),
        );
      }
      if (parsed.paid) {
        await repo.save(
          repo.create({
            tier: 'paid',
            date: 'legacy',
            promptTokens: parsed.paid.promptTokens ?? 0,
            completionTokens: parsed.paid.completionTokens ?? 0,
            totalTokens: parsed.paid.totalTokens ?? 0,
          }),
        );
      }
      await fs.rename(p, `${p}.migrated.bak`);
      this.logger.log(`Migrated token usage from JSON to SQLite: ${p}`);
    } catch (e) {
      this.logger.warn(
        `Could not migrate token usage: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private async importArchiveFromJsonlIfPresent(
    dataDir: string,
  ): Promise<void> {
    const p = path.join(dataDir, ARCHIVE_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(p, 'utf8');
    } catch {
      return;
    }

    const snapRepo = this.dataSource.getRepository(JobSnapshotEntity);
    const logRepo = this.dataSource.getRepository(JobLogRowEntity);
    const byId = new Map<string, ArchivedJobSnapshot>();

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const snap = JSON.parse(trimmed) as ArchivedJobSnapshot;
        const prev = byId.get(snap.id);
        if (!prev || snap.finishedAt >= prev.finishedAt) {
          byId.set(snap.id, snap);
        }
      } catch {
        this.logger.warn('Skipping invalid archive line during migration');
      }
    }

    const seenLogIds = new Set<string>();

    try {
      for (const snap of byId.values()) {
        await this.persistSnapshot(snapRepo, snap);
        for (const log of snap.logs ?? []) {
          if (!log?.id || seenLogIds.has(log.id)) {
            continue;
          }
          seenLogIds.add(log.id);
          await this.persistLog(logRepo, log);
        }
      }
      await fs.rename(p, `${p}.migrated.bak`);
      this.logger.log(`Migrated job archive from JSONL to SQLite: ${p}`);
    } catch (e) {
      this.logger.warn(
        `Could not migrate job archive: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private async persistSnapshot(
    repo: Repository<JobSnapshotEntity>,
    snap: ArchivedJobSnapshot,
  ): Promise<void> {
    const row = new JobSnapshotEntity();
    row.id = snap.id;
    row.state = snap.state;
    row.dataJson = JSON.stringify(snap.data);
    row.progress = snap.progress;
    row.returnValueJson = snap.returnValue
      ? JSON.stringify(snap.returnValue)
      : null;
    row.failedReason = snap.failedReason ?? null;
    row.createdAt = snap.createdAt;
    row.processedAt = snap.processedAt ?? null;
    row.finishedAt = snap.finishedAt;
    row.logsJson = JSON.stringify(snap.logs ?? []);
    await repo.save(row);
  }

  private async persistLog(
    repo: Repository<JobLogRowEntity>,
    log: JobLogEntry,
  ): Promise<void> {
    const row = new JobLogRowEntity();
    row.id = log.id;
    row.jobId = log.jobId ?? null;
    row.level = log.level;
    row.phase = log.phase;
    row.message = log.message;
    row.detailsJson = log.details ? JSON.stringify(log.details) : null;
    row.timestamp = log.timestamp;
    await repo.save(row);
  }
}
