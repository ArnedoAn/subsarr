import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  TranslationProvider,
  TranslationQualityMode,
} from '../contracts/providers';
import { WorkspacePersistenceService } from '../translation-workspace/workspace-persistence.service';
import {
  cueContextHash,
  evaluateSubtitleQuality,
  memorySignature,
  validateCueText,
} from '../translation-workspace/quality-report';
import type { SubtitleQualityReport } from '../translation-workspace/workspace.types';
import { resolveProviderModel } from '../common/translation-provider';
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
  provider?: TranslationProvider;
  model?: string;
  sessionId?: string;
  verificationEnabled?: boolean;
  signal?: AbortSignal;
  onProgress?: TranslationOptions['onProgress'];
  onUsage?: TranslationOptions['onUsage'];
  automatic?: boolean;
  allowBudgetOverride?: boolean;
  qualityMode?: TranslationQualityMode;
  contextHint?: string;
  useTranslationMemory?: boolean;
  checkpointKey?: string;
  persistence?: 'ephemeral' | 'checkpoint';
}
export interface DocumentTranslationResult {
  content: string;
  extension: DocumentExtension;
  cueCount: number;
  warnings: string[];
  usage: TranslationUsage;
  tierUsed: TranslationTier;
  qualityReport?: SubtitleQualityReport;
  checkpointKey?: string;
  checkpointReusedCues?: number;
  memoryReusedCues?: number;
  contextSheet?: string;
}
@Injectable()
export class SubtitleTranslationService {
  constructor(
    private readonly translationService: TranslationService,
    private readonly settingsService: SettingsService,
    private readonly glossaryService: GlossaryService,
    @Optional() private readonly persistence?: WorkspacePersistenceService,
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
    const selected = resolveProviderModel(settings, options);
    const glossaryHint = await this.glossaryService.formatForPrompt();
    throwIfAborted(options.signal);
    const qualityMode = options.qualityMode ?? 'fast';
    if (!['fast', 'balanced', 'review'].includes(qualityMode))
      throw new BadRequestException('Invalid translation quality mode');
    if ((options.contextHint?.length ?? 0) > 12000)
      throw new BadRequestException('Context exceeds 12000 characters');
    const verificationEnabled =
      options.verificationEnabled ?? settings.translationVerificationEnabled;
    const identity = createHash('sha256')
      .update(input)
      .update(
        JSON.stringify({
          sourceLanguage: options.sourceLanguage ?? 'auto',
          targetLanguage: options.targetLanguage,
          ...selected,
          glossaryHint,
          qualityMode,
          verificationEnabled,
          useTranslationMemory: options.useTranslationMemory ?? false,
          contextHint: options.contextHint ?? '',
          promptRevision: 'v1',
        }),
      )
      .digest('hex');
    const store =
      options.persistence === 'ephemeral' ? undefined : this.persistence;
    const checkpoint = await store?.open(identity, options.checkpointKey);
    const sources = document.cues.map((cue) => cue.text);
    const initialTranslations = { ...checkpoint?.translations };
    for (const [index, text] of Object.entries(initialTranslations)) {
      if (!sources[Number(index)])
        throw new BadRequestException('Invalid checkpoint cue index');
      validateCueText(sources[Number(index)], text);
    }
    const checkpointReusedCues = Object.keys(initialTranslations).length;
    let memoryReusedCues = 0;
    const common: TranslationOptions = {
      ...options,
      ...selected,
      sessionId: options.sessionId ?? randomUUID(),
      glossaryHint,
      subtitleFormat: document.extension,
      verificationEnabled,
    };
    const extraUsage: TranslationUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    const extraWarnings: string[] = [];
    let extraTier: TranslationTier | undefined;
    const account = (value: {
      usage: TranslationUsage;
      warnings: string[];
      tierUsed: TranslationTier;
    }) => {
      extraUsage.promptTokens += value.usage.promptTokens;
      extraUsage.completionTokens += value.usage.completionTokens;
      extraUsage.totalTokens += value.usage.totalTokens;
      extraUsage.cacheHitTokens =
        (extraUsage.cacheHitTokens ?? 0) + (value.usage.cacheHitTokens ?? 0);
      extraUsage.cacheMissTokens =
        (extraUsage.cacheMissTokens ?? 0) + (value.usage.cacheMissTokens ?? 0);
      extraWarnings.push(...value.warnings);
      extraTier = value.tierUsed;
    };
    let contextSheet = checkpoint?.contextSheet ?? '';
    if (qualityMode !== 'fast' && !contextSheet) {
      const all = sources.join('\n');
      const points = [
        0,
        Math.floor(all.length / 2),
        Math.max(0, all.length - 1200),
      ];
      const sample = points
        .map((start) =>
          Array.from(all.slice(start, start + 1200))
            .slice(0, 600)
            .join(''),
        )
        .join('\n');
      const context = await this.translationService.translateLines(
        [sample],
        options.targetLanguage,
        settings.openRouterApiKey,
        settings.deepSeekApiKey,
        {
          ...common,
          task: 'context',
          contextHint: options.contextHint,
          verificationEnabled: false,
        },
      );
      account(context);
      contextSheet = context.lines[0]?.slice(0, 10000) ?? '';
      throwIfAborted(options.signal);
      if (checkpoint) await store!.saveContext(checkpoint.key, contextSheet);
    }
    const contextHint = [options.contextHint, contextSheet]
      .filter(Boolean)
      .join('\n')
      .slice(0, 12000);
    if (options.useTranslationMemory && this.persistence) {
      const signature = memorySignature(glossaryHint, contextHint);
      for (let i = 0; i < sources.length; i++) {
        throwIfAborted(options.signal);
        if (initialTranslations[i] !== undefined) continue;
        const entry = await this.persistence.lookup({
          source: sources[i],
          sourceLanguage: options.sourceLanguage ?? 'auto',
          targetLanguage: options.targetLanguage,
          contextHash: cueContextHash(sources, i),
          signature,
        });
        if (entry) {
          // Approved entries may be re-broken by hand; reuse only those that
          // still satisfy the engine's strict structure, else translate normally.
          try {
            validateCueText(sources[i], entry.target);
          } catch {
            continue;
          }
          initialTranslations[i] = entry.target;
          memoryReusedCues++;
        }
      }
    }
    const result = await this.translationService.translateLines(
      sources,
      options.targetLanguage,
      settings.openRouterApiKey,
      settings.deepSeekApiKey,
      {
        ...common,
        contextHint,
        initialTranslations,
        onChunkTranslated: checkpoint
          ? async ({ indices, lines }) => {
              indices.forEach((index, position) =>
                validateCueText(sources[index], lines[position]),
              );
              await store!.saveChunk(checkpoint.key, indices, lines);
            }
          : undefined,
      },
    );
    if (qualityMode === 'review') {
      const suspects = evaluateSubtitleQuality(
        document,
        result.lines,
      ).suspectCueIndices.slice(0, 100);
      for (let start = 0; start < suspects.length; start += 60) {
        throwIfAborted(options.signal);
        const indices = suspects.slice(start, start + 60);
        const candidates = JSON.stringify(
          indices.map((index) => ({
            cueIndex: index,
            candidate: result.lines[index],
          })),
        );
        const reviewContext = `${contextHint.slice(0, 2000)}\nCandidate translations (excerpt if long):\n${candidates.slice(0, 9900)}`;
        const reviewed = await this.translationService.translateLines(
          indices.map((i) => sources[i]),
          options.targetLanguage,
          settings.openRouterApiKey,
          settings.deepSeekApiKey,
          {
            ...common,
            task: 'review',
            contextHint: reviewContext,
            verificationEnabled: false,
          },
        );
        account(reviewed);
        if (reviewed.lines.length !== indices.length)
          throw new Error('Review changed cue boundaries');
        indices.forEach((index, position) => {
          validateCueText(sources[index], reviewed.lines[position]);
          result.lines[index] = reviewed.lines[position];
        });
        if (checkpoint)
          await store!.saveChunk(checkpoint.key, indices, reviewed.lines);
      }
    }
    result.usage.promptTokens += extraUsage.promptTokens;
    result.usage.completionTokens += extraUsage.completionTokens;
    result.usage.totalTokens += extraUsage.totalTokens;
    result.usage.cacheHitTokens =
      (result.usage.cacheHitTokens ?? 0) + (extraUsage.cacheHitTokens ?? 0);
    result.usage.cacheMissTokens =
      (result.usage.cacheMissTokens ?? 0) + (extraUsage.cacheMissTokens ?? 0);
    result.warnings.push(...extraWarnings);
    if (extraTier === 'paid') result.tierUsed = 'paid';
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
      qualityReport: evaluateSubtitleQuality(document, result.lines),
      checkpointKey: checkpoint?.key,
      checkpointReusedCues,
      memoryReusedCues,
      contextSheet: contextHint,
    };
  }
}
