import { type MediaItem } from '../library/media-item.entity';

export interface TranslationConfig {
  sourceLanguage: string;
  targetLanguage: string;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  /** When set, allows translating even if target language already exists (overwrite or alternate filename). */
  targetConflictResolution?: 'replace' | 'alternate';
}

export interface SkipResult {
  skip: boolean;
  reason?: string;
}

export interface RuleDefinition {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  check: (item: MediaItem, config: TranslationConfig) => SkipResult;
}

export interface RuleEvaluation {
  id: string;
  label: string;
  enabled: boolean;
  skip: boolean;
  reason?: string;
}
