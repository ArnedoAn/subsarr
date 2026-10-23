import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { SettingsService } from '../settings/settings.service';
import { GlossaryService } from '../glossary/glossary.service';
import {
  TranslationService,
  type TranslationOptions,
  type TranslationUsage,
  type TranslationTier,
} from './translation.service';
import {
  buildDocument,
  decodeSubtitle,
  parseDocument,
  SUPPORTED_SUBTITLE_FORMATS,
  type DocumentExtension,
  type SubtitleDocument,
} from './subtitle-document';
import { throwIfAborted } from './provider-limiter';
import { looksLikeAssSubtitle } from './subtitle-sniff';
import { subtitleMarkup } from './translation-boundaries';
export {
  decodeSubtitle,
  SUPPORTED_SUBTITLE_FORMATS,
} from './subtitle-document';
export interface DocumentTranslationOptions {
  sourceLanguage?: string;
  targetLanguage: string;
  provider?: 'deepseek' | 'openrouter';
  verificationEnabled?: boolean;
  signal?: AbortSignal;
  onProgress?: TranslationOptions['onProgress'];
  onUsage?: TranslationOptions['onUsage'];
  automatic?: boolean;
  allowBudgetOverride?: boolean;
}
export interface DocumentTranslationResult {
  content: string;
  extension: DocumentExtension;
  cueCount: number;
  warnings: string[];
  usage: TranslationUsage;
  tierUsed: TranslationTier;
}
@Injectable()
export class SubtitleTranslationService {
  constructor(
    private readonly translationService: TranslationService,
    private readonly settingsService: SettingsService,
    private readonly glossaryService: GlossaryService,
  ) {}
  inspectDocument(
    input: Buffer | string,
    filename: string,
  ): { cueCount: number; extension: DocumentExtension } {
    const document = this.loadDocument(input, filename);
    return { cueCount: document.cueCount, extension: document.extension };
  }
  private loadDocument(
    input: Buffer | string,
    filename: string,
  ): SubtitleDocument {
    if (
      (typeof input === 'string'
        ? Buffer.byteLength(input)
        : input.byteLength) >
      8 * 1024 * 1024
    )
      throw new BadRequestException('Subtitle exceeds 8MB limit');
    const suffix = extname(filename).slice(1).toLowerCase();
    if (!SUPPORTED_SUBTITLE_FORMATS.some((format) => format === suffix))
      throw new BadRequestException(
        'Supported subtitle formats: SRT, ASS, SSA, VTT',
      );
    try {
      const content = decodeSubtitle(input);
      const detected: DocumentExtension = looksLikeAssSubtitle(content)
        ? suffix === 'ssa'
          ? 'ssa'
          : 'ass'
        : /^\ufeff?WEBVTT(?:[ \t\r\n]|$)/.test(content)
          ? 'vtt'
          : (suffix as DocumentExtension);
      const document = parseDocument(content, detected);
      if (document.cueCount < 1 || document.cueCount > 10000)
        throw new Error('Subtitle must contain 1 to 10000 valid cues');
      if (document.cues.length === 0)
        throw new Error(
          'Subtitle contains no translatable cues; empty and zero-duration cues are preserved but not sent for translation.',
        );
      return document;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid subtitle document',
      );
    }
  }
  async translateDocument(
    input: Buffer | string,
    filename: string,
    options: DocumentTranslationOptions,
  ): Promise<DocumentTranslationResult> {
    throwIfAborted(options.signal);
    if (!options.targetLanguage.trim())
      throw new BadRequestException('Target language is required');
    const document = this.loadDocument(input, filename);
    const settings = await this.settingsService.getSettings();
    const glossaryHint = await this.glossaryService.formatForPrompt();
    throwIfAborted(options.signal);
    const result = await this.translationService.translateLines(
      document.cues.map((cue) => cue.text),
      options.targetLanguage,
      settings.openRouterApiKey,
      settings.deepSeekApiKey,
      {
        ...options,
        glossaryHint,
        subtitleFormat: document.extension,
        verificationEnabled:
          options.verificationEnabled ??
          settings.translationVerificationEnabled,
      },
    );
    if (result.lines.length !== document.cues.length)
      throw new Error('Translated subtitle changed cue boundaries');
    for (let i = 0; i < result.lines.length; i++) {
      const source = document.cues[i].text;
      if (
        JSON.stringify(subtitleMarkup(source)) !==
        JSON.stringify(subtitleMarkup(result.lines[i]))
      )
        throw new Error('Translated subtitle changed protected markup');
      if (
        (source.match(/\n/g)?.length ?? 0) !==
        (result.lines[i].match(/\r\n|\r|\n/g)?.length ?? 0)
      )
        throw new Error(
          'Translated subtitle changed cue boundaries or line structure',
        );
    }
    const content = buildDocument(document, result.lines);
    if (Buffer.byteLength(content) > 8 * 1024 * 1024)
      throw new Error('Translated subtitle exceeds 8MB limit');
    const rebuilt = parseDocument(content, document.extension);
    if (
      rebuilt.cueCount !== document.cueCount ||
      JSON.stringify(rebuilt.preservedCues) !==
        JSON.stringify(document.preservedCues) ||
      rebuilt.cues.length !== document.cues.length ||
      rebuilt.cues.some(
        (cue, i) =>
          cue.start !== document.cues[i].start ||
          cue.end !== document.cues[i].end ||
          cue.index !== document.cues[i].index,
      )
    )
      throw new Error(
        'Translated subtitle changed cue boundaries or timestamps',
      );
    return {
      content,
      extension: document.extension,
      cueCount: document.cueCount,
      warnings: result.warnings,
      usage: result.usage,
      tierUsed: result.tierUsed,
    };
  }
}
