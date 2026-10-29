import type {
  TranslationBillingTier,
  TranslationProvider,
} from '../contracts/providers';

/** Only explicitly free OpenRouter routes are classified as free. */
export function isFreeOpenRouterModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'openrouter/free' || normalized.endsWith(':free');
}

/** Provider response cost for Go is quota-equivalent, not a monetary charge. */
export function getProviderBillingTier(
  provider: TranslationProvider,
  model: string,
  responseCostUsd?: number,
): TranslationBillingTier {
  if (provider === 'opencode-go') return 'subscription';
  return provider === 'openrouter' &&
    isFreeOpenRouterModel(model) &&
    !(responseCostUsd && responseCostUsd > 0)
    ? 'free'
    : 'paid';
}

export const SUBSCRIPTION_PRICING_SOURCE =
  'subscription_included; monetary charge unknown; ExtraUsage disabled in console recommended';
