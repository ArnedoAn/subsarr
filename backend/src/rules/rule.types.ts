import { type MediaItem } from '../library/media-item.entity';

export interface TranslationConfig {
  sourceLanguage: string;
  targetLanguage: string;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
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
