import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type ProviderUsage } from '../translation/translation.service';
import { SettingEntity } from '../database/entities/setting.entity';
import { TokenUsageRowEntity } from '../database/entities/token-usage-row.entity';
import {
  type TierUsageSummary,
  type TokenUsageSummary,
} from './dto/token-usage-summary.dto';
import { estimateDeepSeekCostUsd } from './deepseek-pricing';
import { isFreeOpenRouterModel } from './provider-pricing';

@Injectable()
export class TokenUsageService {
  private readonly logger = new Logger(TokenUsageService.name);
  private usageWrite: Promise<void> = Promise.resolve();

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

  /** Costs are recorded at response time using the then-configured pricing. */
  async getMonthPaidCostEstimateUsd(): Promise<number> {
    const prefix = new Date().toISOString().slice(0, 7);
    const rows = await this.usageRepo
      .createQueryBuilder('u')
      .where('u.tier = :t', { t: 'paid' })
      .andWhere('u.date LIKE :p', { p: `${prefix}%` })
      .getMany();
    return rows.reduce((sum, row) => sum + row.costUsd, 0);
  }

  async addProviderUsage(attempt: ProviderUsage): Promise<void> {
    for (const value of [
      attempt.promptTokens,
      attempt.completionTokens,
      attempt.totalTokens,
      attempt.cacheHitTokens,
      attempt.cacheMissTokens,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid provider token accounting');
    }
    if (
      !['deepseek', 'openrouter'].includes(attempt.provider) ||
      !['free', 'paid'].includes(attempt.tier)
    )
      throw new Error('Invalid provider usage');
    if (
      attempt.costUsd !== undefined &&
      (!Number.isFinite(attempt.costUsd) || attempt.costUsd < 0)
    )
      throw new Error('Invalid provider response cost');
    const tier =
      attempt.provider === 'openrouter' &&
      isFreeOpenRouterModel(attempt.model) &&
      !(attempt.costUsd && attempt.costUsd > 0)
        ? 'free'
        : 'paid';
    const date = this.todayUtc();
    // The append-only response ledger and daily aggregate commit together. SQL
    // increments prevent concurrent HTTP responses losing each other's usage.
    const write = this.usageWrite.then(async () =>
      this.usageRepo.manager.transaction(async (manager) => {
        const settings = await manager.findOne(SettingEntity, {
          where: { id: 'main' },
        });
        const hit = settings?.deepSeekInputCacheHitUsdPerMillion ?? 0.028;
        const miss = settings?.deepSeekInputCacheMissUsdPerMillion ?? 0.28;
        const output = settings?.deepSeekOutputUsdPerMillion ?? 0.42;
        const cost =
          attempt.costUsd ??
          (tier === 'free'
            ? 0
            : (attempt.cacheHitTokens * hit +
                attempt.cacheMissTokens * miss +
                attempt.completionTokens * output) /
              1_000_000);
        const pricingSource =
          attempt.costUsd !== undefined
            ? `${attempt.provider} response usage.cost (actual USD)`
            : `${settings?.pricingSource ?? 'https://api-docs.deepseek.com/quick_start/pricing'}${attempt.provider === 'openrouter' && tier === 'paid' ? ' (DeepSeek-rate estimate; OpenRouter response cost unavailable)' : ''}`;
        await manager.query(
          `INSERT INTO provider_usage_attempts
        (createdAt,date,provider,model,tier,promptTokens,completionTokens,totalTokens,cacheHitTokens,cacheMissTokens,costUsd,pricingSource,pricingUpdatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            new Date().toISOString(),
            date,
            attempt.provider,
            attempt.model,
            tier,
            attempt.promptTokens,
            attempt.completionTokens,
            attempt.totalTokens,
            attempt.cacheHitTokens,
            attempt.cacheMissTokens,
            cost,
            pricingSource,
            attempt.costUsd !== undefined
              ? date
              : (settings?.pricingUpdatedAt ?? '2025-09-05'),
          ],
        );
        await manager.query(
          `INSERT INTO token_usage (tier,date,promptTokens,completionTokens,totalTokens,cacheHitTokens,cacheMissTokens,costUsd)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tier,date) DO UPDATE SET
        promptTokens=promptTokens+excluded.promptTokens, completionTokens=completionTokens+excluded.completionTokens,
        totalTokens=totalTokens+excluded.totalTokens, cacheHitTokens=cacheHitTokens+excluded.cacheHitTokens,
        cacheMissTokens=cacheMissTokens+excluded.cacheMissTokens, costUsd=costUsd+excluded.costUsd`,
          [
            tier,
            date,
            attempt.promptTokens,
            attempt.completionTokens,
            attempt.totalTokens,
            attempt.cacheHitTokens,
            attempt.cacheMissTokens,
            cost,
          ],
        );
      }),
    );
    this.usageWrite = write.catch(() => undefined);
    await write;
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
      estimatedCostUsd: paidRows.reduce((sum, row) => sum + row.costUsd, 0),
      today: {
        free: today.free,
        paid: today.paid,
        estimatedCostUsd: [...freeRows, ...paidRows]
          .filter((row) => row.date === this.todayUtc())
          .reduce((sum, row) => sum + row.costUsd, 0),
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
