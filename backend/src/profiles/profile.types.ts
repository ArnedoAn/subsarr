import type { TranslationProvider } from '../contracts/providers';

export interface TranslationProfile {
  id: string;
  name: string;
  /** Longest matching prefix wins (normalized with path separators). */
  pathPrefix: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider?: TranslationProvider;
  model?: string;
}

export interface ProfilesFile {
  profiles: TranslationProfile[];
}
