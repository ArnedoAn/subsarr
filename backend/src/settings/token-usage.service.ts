import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  type TranslationTier,
  type TranslationUsage,
} from '../translation/translation.service';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { type TokenUsageSummary } from './dto/token-usage-summary.dto';

const USAGE_FILENAME = 'token-usage.json';

interface InternalSummary {
  free: TranslationUsage;
  paid: TranslationUsage;
}

@Injectable()
export class TokenUsageService implements OnModuleInit {
  private readonly logger = new Logger(TokenUsageService.name);
  private readonly usagePath: string;
  private summary: InternalSummary = {
    free: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    paid: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    const dataDir = config?.dataDir ?? '/data';
    this.usagePath = path.join(dataDir, USAGE_FILENAME);
  }

  async onModuleInit(): Promise<void> {
    try {
      const raw = await fs.readFile(this.usagePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<InternalSummary>;
      if (parsed.free) {
        this.summary.free = { ...this.summary.free, ...parsed.free };
      }
      if (parsed.paid) {
        this.summary.paid = { ...this.summary.paid, ...parsed.paid };
      }
    } catch {
      /* missing or invalid */
    }
  }

  private async persist(): Promise<void> {
    try {
      const dir = path.dirname(this.usagePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        this.usagePath,
        JSON.stringify(this.summary, null, 2),
        'utf8',
      );
    } catch (e) {
      this.logger.warn(
        `Could not persist token usage: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  addUsage(tier: TranslationTier, usage: TranslationUsage): void {
    const target = this.summary[tier];
    target.promptTokens += usage.promptTokens;
    target.completionTokens += usage.completionTokens;
    target.totalTokens += usage.totalTokens;
    void this.persist();
  }

  getSummary(): TokenUsageSummary {
    const paidInputCost = (this.summary.paid.promptTokens / 1_000_000) * 0.14;
    const paidOutputCost =
      (this.summary.paid.completionTokens / 1_000_000) * 0.28;

    return {
      free: { ...this.summary.free },
      paid: { ...this.summary.paid },
      deepSeekEstimatedCostUsd: Number(
        (paidInputCost + paidOutputCost).toFixed(6),
      ),
    };
  }
}
