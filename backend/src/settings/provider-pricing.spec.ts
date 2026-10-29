import {
  getProviderBillingTier,
  isFreeOpenRouterModel,
  SUBSCRIPTION_PRICING_SOURCE,
} from './provider-pricing';

describe('provider billing classification', () => {
  it('keeps subscription quota-equivalent costs separate from monetary charges', () => {
    expect(getProviderBillingTier('opencode-go', 'glm-5.2')).toBe(
      'subscription',
    );
    expect(getProviderBillingTier('opencode-go', 'glm-5.2', 12.5)).toBe(
      'subscription',
    );
    expect(getProviderBillingTier('opencode-go', 'beam-free', 0)).toBe(
      'subscription',
    );
    expect(SUBSCRIPTION_PRICING_SOURCE).toBe(
      'subscription_included; monetary charge unknown; ExtraUsage disabled in console recommended',
    );
  });

  it('preserves paid providers and explicit free OpenRouter routes', () => {
    expect(getProviderBillingTier('deepseek', 'deepseek-chat')).toBe('paid');
    expect(getProviderBillingTier('openrouter', 'vendor/model')).toBe('paid');
    expect(getProviderBillingTier('openrouter', 'openrouter/free')).toBe(
      'free',
    );
    expect(getProviderBillingTier('openrouter', 'vendor/model:free')).toBe(
      'free',
    );
    expect(getProviderBillingTier('openrouter', 'vendor/model:free', 0.1)).toBe(
      'paid',
    );
    expect(isFreeOpenRouterModel(' Vendor/Model:FREE ')).toBe(true);
    expect(isFreeOpenRouterModel('vendor/not-free')).toBe(false);
  });
});
