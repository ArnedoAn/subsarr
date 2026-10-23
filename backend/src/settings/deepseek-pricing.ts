/** Default price snapshot; persisted settings may override it. USD per million. */
export const DEEPSEEK_USD_PER_1M_INPUT_CACHE_MISS = 0.28;
export const DEEPSEEK_USD_PER_1M_OUTPUT = 0.42;
export const DEEPSEEK_USD_PER_1M_INPUT_CACHE_HIT = 0.028;

export function estimateDeepSeekCostUsd(
  paidPromptTokens: number,
  paidCompletionTokens: number,
  cacheHitTokens = 0,
  pricing?: {
    deepSeekInputCacheHitUsdPerMillion?: number;
    deepSeekInputCacheMissUsdPerMillion?: number;
    deepSeekOutputUsdPerMillion?: number;
  },
): number {
  const hitTokens = Math.min(paidPromptTokens, Math.max(0, cacheHitTokens));
  return (
    (hitTokens *
      (pricing?.deepSeekInputCacheHitUsdPerMillion ??
        DEEPSEEK_USD_PER_1M_INPUT_CACHE_HIT) +
      (paidPromptTokens - hitTokens) *
        (pricing?.deepSeekInputCacheMissUsdPerMillion ??
          DEEPSEEK_USD_PER_1M_INPUT_CACHE_MISS) +
      paidCompletionTokens *
        (pricing?.deepSeekOutputUsdPerMillion ?? DEEPSEEK_USD_PER_1M_OUTPUT)) /
    1_000_000
  );
}
