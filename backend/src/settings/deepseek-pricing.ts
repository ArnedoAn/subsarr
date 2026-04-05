/** DeepSeek API official pricing (USD per 1M tokens), cache-miss input + output. */
export const DEEPSEEK_USD_PER_1M_INPUT_CACHE_MISS = 0.28;
export const DEEPSEEK_USD_PER_1M_OUTPUT = 0.42;

/** Only paid (DeepSeek) tokens contribute to USD; OpenRouter free tier = $0. */
export function estimateDeepSeekCostUsd(
  paidPromptTokens: number,
  paidCompletionTokens: number,
): number {
  return Number(
    (
      (paidPromptTokens / 1_000_000) * DEEPSEEK_USD_PER_1M_INPUT_CACHE_MISS +
      (paidCompletionTokens / 1_000_000) * DEEPSEEK_USD_PER_1M_OUTPUT
    ).toFixed(6),
  );
}
