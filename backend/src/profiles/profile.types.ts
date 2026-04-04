export interface TranslationProfile {
  id: string;
  name: string;
  /** Longest matching prefix wins (normalized with path separators). */
  pathPrefix: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider?: 'openrouter' | 'deepseek';
}

export interface ProfilesFile {
  profiles: TranslationProfile[];
}
