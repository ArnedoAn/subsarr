export interface TierUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageSummary {
  free: TierUsageSummary;
  paid: TierUsageSummary;
  deepSeekEstimatedCostUsd: number;
  /** UTC calendar day (today): tokens persisted for that date only. */
  today?: {
    free: TierUsageSummary;
    paid: TierUsageSummary;
    deepSeekEstimatedCostUsd: number;
  };
}
