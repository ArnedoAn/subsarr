export interface TierUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageSummary {
  free: TierUsageSummary;
  paid: TierUsageSummary;
  deepSeekEstimatedCostUsd: number;
}
