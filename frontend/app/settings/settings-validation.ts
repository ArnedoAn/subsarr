export const NUMERIC_SETTINGS = {
  scanCacheTtlMinutes: { min: 1, max: 10080, integer: true, section: 'library', label: 'Scan cache TTL' },
  concurrency: { min: 1, max: 16, integer: true, section: 'advanced', label: 'Concurrent jobs' },
  fileTooLargeBytes: { min: 1, max: Number.MAX_SAFE_INTEGER, optional: true, integer: true, section: 'library', label: 'Maximum file size' },
  dailyTokenLimitFree: { min: 0, max: 1e12, optional: true, integer: true, section: 'providers', label: 'Daily free token limit' },
  dailyTokenLimitPaid: { min: 0, max: 1e12, optional: true, integer: true, section: 'providers', label: 'Daily paid token limit' },
  monthlyBudgetUsd: { min: 0, max: 1e6, optional: true, section: 'providers', label: 'Monthly budget' },
  deepSeekInputCacheHitUsdPerMillion: { min: 0, max: 1000, section: 'providers', label: 'Cache-hit input price' },
  deepSeekInputCacheMissUsdPerMillion: { min: 0, max: 1000, section: 'providers', label: 'Cache-miss input price' },
  deepSeekOutputUsdPerMillion: { min: 0, max: 1000, section: 'providers', label: 'Output price' },
} satisfies Record<string, { min: number; max: number; optional?: boolean; integer?: boolean; section: string; label: string }>;
export type NumericKey = keyof typeof NUMERIC_SETTINGS;
export const NUMBERS = Object.keys(NUMERIC_SETTINGS) as NumericKey[];

// Validate every draft, including controls in settings sections that are not mounted.
export function validateNumericSettings(drafts: Record<NumericKey, string>, badInputs: Partial<Record<NumericKey, boolean>> = {}) {
  for (const key of NUMBERS) {
    const bounds: { min: number; max: number; optional?: boolean; integer?: boolean; section: string; label: string } = NUMERIC_SETTINGS[key];
    const draft = drafts[key];
    if (draft === '' && bounds.optional && !badInputs[key]) continue;
    const value = Number(draft);
    if (badInputs[key] || draft.trim() === '' || !Number.isFinite(value) || value < bounds.min || value > bounds.max || (bounds.integer && !Number.isInteger(value))) {
      return { key, section: bounds.section, message: `${bounds.label}: enter ${bounds.integer ? 'a whole number' : 'a number'} between ${bounds.min} and ${bounds.max.toLocaleString()}.` };
    }
  }
  return null;
}
