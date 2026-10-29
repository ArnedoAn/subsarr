import type { SettingsPayload, TranslationProvider } from './types';

export const PROVIDERS: ReadonlyArray<{ id: TranslationProvider; label: string }> = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'opencode-go', label: 'OpenCode Go (subscription)' },
];
export const isTranslationProvider = (value: unknown): value is TranslationProvider => PROVIDERS.some(provider => provider.id === value);
export function savedProviderModel(settings: SettingsPayload, provider: TranslationProvider): string {
  return provider === 'opencode-go' ? settings.opencodeGoModel : provider === 'deepseek' ? settings.deepSeekModel : settings.openRouterModel;
}
