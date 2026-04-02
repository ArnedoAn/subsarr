import { Injectable } from '@nestjs/common';
import { type MediaItem } from '../library/media-item.entity';
import { SettingsService } from '../settings/settings.service';
import {
  type RuleDefinition,
  type RuleEvaluation,
  type SkipResult,
  type TranslationConfig,
} from './rule.types';

const IMAGE_BASED_CODECS = new Set([
  'dvd_subtitle',
  'hdmv_pgs_subtitle',
  'xsub',
  'dvb_subtitle',
]);

@Injectable()
export class RulesService {
  constructor(private readonly settingsService: SettingsService) {}

  async getDefinitions(): Promise<RuleDefinition[]> {
    const settings = await this.settingsService.getSettings();
    const byId = new Map(settings.rules.map((rule) => [rule.id, rule.enabled]));

    const definitions: RuleDefinition[] = [
      {
        id: 'already-has-target-subtitle',
        label: 'Already has target subtitle',
        description:
          'Skips files where an embedded subtitle track exists in the target language.',
        enabled: byId.get('already-has-target-subtitle') ?? true,
        check: (item, config) => {
          if (
            config.targetConflictResolution === 'replace' ||
            config.targetConflictResolution === 'alternate'
          ) {
            return { skip: false };
          }
          const match = item.subtitleTracks.some(
            (track) => track.language === config.targetLanguage,
          );
          return match
            ? {
                skip: true,
                reason: `Embedded target subtitle already exists (${config.targetLanguage})`,
              }
            : { skip: false };
        },
      },
      {
        id: 'already-has-external-subtitle',
        label: 'Already has external subtitle',
        description:
          'Skips files where an external subtitle already exists for target language.',
        enabled: byId.get('already-has-external-subtitle') ?? true,
        check: (item, config) => {
          if (
            config.targetConflictResolution === 'replace' ||
            config.targetConflictResolution === 'alternate'
          ) {
            return { skip: false };
          }
          const match = item.externalSubtitles.some(
            (sub) => sub.language === config.targetLanguage,
          );
          return match
            ? {
                skip: true,
                reason: `External target subtitle already exists (${config.targetLanguage})`,
              }
            : { skip: false };
        },
      },
      {
        id: 'no-source-track',
        label: 'No source track',
        description:
          'Skips files that do not contain a subtitle track for the source language.',
        enabled: byId.get('no-source-track') ?? true,
        check: (item, config) => {
          const match = item.subtitleTracks.some(
            (track) => track.language === config.sourceLanguage,
          );
          return !match
            ? {
                skip: true,
                reason: `No source subtitle track found for ${config.sourceLanguage}`,
              }
            : { skip: false };
        },
      },
      {
        id: 'image-based-subtitle',
        label: 'Image based subtitle',
        description:
          'Skips files where source subtitle tracks are image-based and require OCR.',
        enabled: byId.get('image-based-subtitle') ?? true,
        check: (item, config) => {
          const sourceTracks = item.subtitleTracks.filter(
            (track) => track.language === config.sourceLanguage,
          );
          if (sourceTracks.length === 0) {
            return { skip: false };
          }

          const allImageBased = sourceTracks.every((track) =>
            IMAGE_BASED_CODECS.has(track.codec),
          );
          return allImageBased
            ? {
                skip: true,
                reason: `Source tracks are image-based (${sourceTracks.map((track) => track.codec).join(', ')})`,
              }
            : { skip: false };
        },
      },
      {
        id: 'file-too-large',
        label: 'File too large',
        description: 'Skips files larger than configured byte threshold.',
        enabled: byId.get('file-too-large') ?? false,
        check: (item, config) => {
          if (!config.fileTooLargeBytes) {
            return { skip: false };
          }

          return item.size > config.fileTooLargeBytes
            ? {
                skip: true,
                reason: `File exceeds size limit (${config.fileTooLargeBytes} bytes)`,
              }
            : { skip: false };
        },
      },
      {
        id: 'path-contains',
        label: 'Path contains exclusion',
        description:
          'Skips files if path includes configured exclusion fragments.',
        enabled: byId.get('path-contains') ?? true,
        check: (item, config) => {
          const hit = config.pathContainsExclusions.find((entry) =>
            item.path.includes(entry),
          );
          return hit
            ? { skip: true, reason: `Path matches exclusion: ${hit}` }
            : { skip: false };
        },
      },
    ];

    return definitions;
  }

  async evaluate(
    item: MediaItem,
    override?: Partial<TranslationConfig>,
  ): Promise<SkipResult> {
    const definitions = await this.getDefinitions();
    const config = await this.getTranslationConfig(override);
    return this.evaluateWithConfig(item, definitions, config);
  }

  evaluateWithConfig(
    item: MediaItem,
    definitions: RuleDefinition[],
    config: TranslationConfig,
  ): SkipResult {
    for (const rule of definitions) {
      if (!rule.enabled) {
        continue;
      }

      const result = rule.check(item, config);
      if (result.skip) {
        return result;
      }
    }

    return { skip: false };
  }

  async evaluateAll(
    item: MediaItem,
    override?: Partial<TranslationConfig>,
  ): Promise<RuleEvaluation[]> {
    const definitions = await this.getDefinitions();
    const config = await this.getTranslationConfig(override);

    return definitions.map((rule) => {
      if (!rule.enabled) {
        return {
          id: rule.id,
          label: rule.label,
          enabled: false,
          skip: false,
        };
      }

      const result = rule.check(item, config);
      return {
        id: rule.id,
        label: rule.label,
        enabled: true,
        skip: result.skip,
        reason: result.reason,
      };
    });
  }

  async getTranslationConfig(
    override?: Partial<TranslationConfig>,
  ): Promise<TranslationConfig> {
    const settings = await this.settingsService.getSettings();
    return {
      sourceLanguage: (
        override?.sourceLanguage ?? settings.sourceLanguage
      ).toLowerCase(),
      targetLanguage: (
        override?.targetLanguage ?? settings.targetLanguage
      ).toLowerCase(),
      pathContainsExclusions:
        override?.pathContainsExclusions ?? settings.pathContainsExclusions,
      fileTooLargeBytes:
        override?.fileTooLargeBytes ?? settings.fileTooLargeBytes,
      targetConflictResolution: override?.targetConflictResolution,
    };
  }
}
