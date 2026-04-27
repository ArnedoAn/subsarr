import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  type TranslationTier,
  type TranslationUsage,
} from '../translation/translation.service';
import { TokenUsageRowEntity } from '../database/entities/token-usage-row.entity';
import {
  type TierUsageSummary,
  type TokenUsageSummary,
} from './dto/token-usage-summary.dto';
import { estimateDeepSeekCostUsd } from './deepseek-pricing';

@Injectable()
export class TokenUsageService {
  private readonly logger = new Logger(TokenUsageService.name);

  /** USD estimate for DeepSeek paid tier (cache-miss input pricing). Free tier → 0. */
  static estimateCostUsd(
    tier: 'free' | 'paid',
    promptTokens: number,
    completionTokens: number,
  ): number {
    if (tier === 'free') return 0;
    return estimateDeepSeekCostUsd(promptTokens, completionTokens);
  }

  constructor(
    @InjectRepository(TokenUsageRowEntity)
    private readonly usageRepo: Repository<TokenUsageRowEntity>,
  ) {}

  private todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async getTodayTotals(): Promise<{ free: number; paid: number }> {
    const date = this.todayUtc();
    const rows = await this.usageRepo.find({ where: { date } });
    let free = 0;
    let paid = 0;
    for (const r of rows) {
      if (r.tier === 'free') {
        free += r.totalTokens;
      } else if (r.tier === 'paid') {
        paid += r.totalTokens;
      }
    }
    return { free, paid };
  }

  /** DeepSeek-style cost estimate for paid tier rows in current UTC month. */
  async getMonthPaidCostEstimateUsd(): Promise<number> {
    const prefix = new Date().toISOString().slice(0, 7);
    const rows = await this.usageRepo
      .createQueryBuilder('u')
      .where('u.tier = :t', { t: 'paid' })
      .andWhere('u.date LIKE :p', { p: `${prefix}%` })
      .andWhere('u.date != :legacy', { legacy: 'legacy' })
      .getMany();
    const prompt = rows.reduce((a, r) => a + r.promptTokens, 0);
    const completion = rows.reduce((a, r) => a + r.completionTokens, 0);
    return estimateDeepSeekCostUsd(prompt, completion);
  }

  async addUsage(
    tier: TranslationTier,
    usage: TranslationUsage,
  ): Promise<void> {
    const date = this.todayUtc();
    try {
      let row = await this.usageRepo.findOne({ where: { tier, date } });
      if (!row) {
        row = this.usageRepo.create({
          tier,
          date,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        });
      }
      row.promptTokens += usage.promptTokens;
      row.completionTokens += usage.completionTokens;
      row.totalTokens += usage.totalTokens;
      await this.usageRepo.save(row);
    } catch (e) {
      this.logger.warn(
        `Could not persist token usage: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Aggregates for the current UTC date (rows in DB for today). */
  private async getTodayTierTotals(): Promise<{
    free: TierUsageSummary;
    paid: TierUsageSummary;
  }> {
    const date = this.todayUtc();
    const rows = await this.usageRepo.find({ where: { date } });
    const empty: TierUsageSummary = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    const free = { ...empty };
    const paid = { ...empty };
    for (const r of rows) {
      if (r.tier === 'free') {
        free.promptTokens += r.promptTokens;
        free.completionTokens += r.completionTokens;
        free.totalTokens += r.totalTokens;
      } else if (r.tier === 'paid') {
        paid.promptTokens += r.promptTokens;
        paid.completionTokens += r.completionTokens;
        paid.totalTokens += r.totalTokens;
      }
    }
    return { free, paid };
  }

  async getSummary(): Promise<TokenUsageSummary> {
    const freeRows = await this.usageRepo.find({ where: { tier: 'free' } });
    const paidRows = await this.usageRepo.find({ where: { tier: 'paid' } });

    const free = freeRows.reduce(
      (acc, r) => ({
        promptTokens: acc.promptTokens + r.promptTokens,
        completionTokens: acc.completionTokens + r.completionTokens,
        totalTokens: acc.totalTokens + r.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );

    const paid = paidRows.reduce(
      (acc, r) => ({
        promptTokens: acc.promptTokens + r.promptTokens,
        completionTokens: acc.completionTokens + r.completionTokens,
        totalTokens: acc.totalTokens + r.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );

    const today = await this.getTodayTierTotals();

    return {
      free,
      paid,
      deepSeekEstimatedCostUsd: estimateDeepSeekCostUsd(
        paid.promptTokens,
        paid.completionTokens,
      ),
      today: {
        free: today.free,
        paid: today.paid,
        deepSeekEstimatedCostUsd: estimateDeepSeekCostUsd(
          today.paid.promptTokens,
          today.paid.completionTokens,
        ),
      },
    };
  }

  /** Last N calendar days (UTC), excluding `legacy` import row. */
  async getDailyTokenSeries(
    lastDays: number,
  ): Promise<Array<{ date: string; free: number; paid: number }>> {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (lastDays - 1));
    const from = start.toISOString().slice(0, 10);
    const rows = await this.usageRepo
      .createQueryBuilder('u')
      .where('u.date != :legacy', { legacy: 'legacy' })
      .andWhere('u.date >= :from', { from })
      .getMany();

    const byDate = new Map<string, { free: number; paid: number }>();
    for (const r of rows) {
      if (!byDate.has(r.date)) {
        byDate.set(r.date, { free: 0, paid: 0 });
      }
      const b = byDate.get(r.date)!;
      if (r.tier === 'free') {
        b.free += r.totalTokens;
      } else if (r.tier === 'paid') {
        b.paid += r.totalTokens;
      }
    }

    const out: Array<{ date: string; free: number; paid: number }> = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const v = byDate.get(key) ?? { free: 0, paid: 0 };
      out.push({ date: key, ...v });
    }
    return out;
  }
}
