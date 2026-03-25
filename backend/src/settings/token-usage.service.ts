import { Injectable } from '@nestjs/common';
import {
  type TranslationTier,
  type TranslationUsage,
} from '../translation/translation.service';
import { type TokenUsageSummary } from './dto/token-usage-summary.dto';

interface InternalSummary {
  free: TranslationUsage;
  paid: TranslationUsage;
}

@Injectable()
export class TokenUsageService {
  private summary: InternalSummary = {
    free: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    paid: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };

  addUsage(tier: TranslationTier, usage: TranslationUsage): void {
    const target = this.summary[tier];
    target.promptTokens += usage.promptTokens;
    target.completionTokens += usage.completionTokens;
    target.totalTokens += usage.totalTokens;
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
