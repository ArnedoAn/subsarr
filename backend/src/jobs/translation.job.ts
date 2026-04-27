import { Logger, forwardRef, Inject } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { type Job } from 'bull';
import { promises as fs } from 'node:fs';
import * as jschardet from 'jschardet';
import iconv from 'iconv-lite';
import { ExtractionService } from '../extraction/extraction.service';
import {
  type JobProgressTokenUsage,
  type JobReturnValue,
  type TranslationJobPayload,
} from './jobs.types';
import { LibraryService } from '../library/library.service';
import { RulesService } from '../rules/rules.service';
import { SettingsService } from '../settings/settings.service';
import { SrtParser } from '../translation/srt-parser';
import { SrtBuilder } from '../translation/srt-builder';
import { AssParser } from '../translation/ass-parser';
import { AssBuilder } from '../translation/ass-builder';
import { TranslationService } from '../translation/translation.service';
import { OutputService } from '../output/output.service';
import { JobsEventsService } from './jobs-events.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { JobLogsService } from './job-logs.service';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';
import { looksLikeAssSubtitle } from '../translation/subtitle-sniff';
import { type SubtitlePathVariant } from '../output/output.service';
import { JobArchiveService } from './job-archive.service';
import { TelegramService } from '../notifications/telegram.service';
import { GlossaryService } from '../glossary/glossary.service';
import { JellyfinService } from '../integrations/jellyfin.service';
import { estimateDeepSeekCostUsd } from '../settings/deepseek-pricing';

@Processor('translation')
export class TranslationJobProcessor {
  private readonly logger = new Logger(TranslationJobProcessor.name);

  constructor(
    private readonly extractionService: ExtractionService,
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
    private readonly settingsService: SettingsService,
    private readonly translationService: TranslationService,
    private readonly outputService: OutputService,
    private readonly jobsEventsService: JobsEventsService,
    private readonly tokenUsageService: TokenUsageService,
    private readonly jobLogsService: JobLogsService,
    private readonly jobArchiveService: JobArchiveService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly glossaryService: GlossaryService,
    private readonly jellyfinService: JellyfinService,
  ) {}

  @Process({ concurrency: Number(process.env.SUBSYNC_CONCURRENCY ?? 2) })
  async handle(job: Job<TranslationJobPayload>) {
    const jobId = String(job.id);

    // Si Bull reutiliza el mismo ID numérico tras un restart de Redis,
    // borramos los logs del job anterior para evitar mezcla en los "recent logs".
    await this.jobLogsService.clearByJob(jobId);
    const outputExtension: SubtitleOutputExtension =
      job.data.outputExtension ?? 'srt';
    const pathVariant: SubtitlePathVariant =
      job.data.targetConflictResolution === 'alternate'
        ? 'alternate'
        : 'default';

    let lastTranslatingProgress = 25;
    let lastTranslatingMessage = '';
    let lastTranslatingDetails: any = undefined;

    let lastPersistedFree = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let lastPersistedPaid = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    const persistTokenUsageDelta = async (info: {
      usageByTier: {
        free: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        paid: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
      };
    }) => {
      const uf = info.usageByTier.free;
      const up = info.usageByTier.paid;
      const df = {
        promptTokens: uf.promptTokens - lastPersistedFree.promptTokens,
        completionTokens:
          uf.completionTokens - lastPersistedFree.completionTokens,
        totalTokens: uf.totalTokens - lastPersistedFree.totalTokens,
      };
      if (df.promptTokens !== 0 || df.completionTokens !== 0) {
        await this.tokenUsageService.addUsage('free', df);
        lastPersistedFree = { ...uf };
      }
      const dp = {
        promptTokens: up.promptTokens - lastPersistedPaid.promptTokens,
        completionTokens:
          up.completionTokens - lastPersistedPaid.completionTokens,
        totalTokens: up.totalTokens - lastPersistedPaid.totalTokens,
      };
      if (dp.promptTokens !== 0 || dp.completionTokens !== 0) {
        await this.tokenUsageService.addUsage('paid', dp);
        lastPersistedPaid = { ...up };
      }
    };

    const publish = async (
      phase:
        | 'active'
        | 'extracting'
        | 'translating'
        | 'validating'
        | 'correcting'
        | 'writing'
        | 'completed'
        | 'failed',
      progressPercent: number,
      message: string,
      details?: any,
      tokenUsage?: JobProgressTokenUsage,
    ) => {
      this.jobsEventsService.publish(jobId, {
        phase,
        progressPercent,
        message,
        timestamp: new Date().toISOString(),
        details,
        tokenUsage,
      });
      void job.progress(progressPercent);

      await this.jobLogsService.append({
        jobId,
        level: phase === 'failed' ? 'error' : 'info',
        phase,
        message,
        details,
      });
    };

    try {
      await publish('active', 0, 'Job started');

      const item = await this.libraryService.getById(job.data.mediaItemId);
      if (!job.data.forceBypassRules) {
        const ruleResult = await this.rulesService.evaluate(item, {
          sourceLanguage: job.data.sourceLanguage,
          targetLanguage: job.data.targetLanguage,
        });
        if (ruleResult.skip) {
          throw new Error(`Job blocked by rules: ${ruleResult.reason}`);
        }
      }

      await publish('extracting', 10, 'Extracting subtitle track');
      let extraction = await this.extractionService.extractSubtitleTrack(
        item.path,
        job.data.sourceTrackIndex,
        outputExtension,
      );

      const decodeFile = async (filePath: string): Promise<string> => {
        const rawBuffer = await fs.readFile(filePath);
        const detection = jschardet.detect(rawBuffer);
        return detection.encoding
          ? iconv.decode(rawBuffer, detection.encoding)
          : rawBuffer.toString('utf8');
      };

      let decoded = await decodeFile(extraction.tempFilePath);
      let effectiveExtension: SubtitleOutputExtension = outputExtension;

      if (outputExtension === 'srt') {
        try {
          const assTry = await this.extractionService.extractSubtitleTrack(
            item.path,
            job.data.sourceTrackIndex,
            'ass',
          );
          const assDecoded = await decodeFile(assTry.tempFilePath);
          if (looksLikeAssSubtitle(assDecoded)) {
            await fs.unlink(extraction.tempFilePath).catch(() => undefined);
            extraction = assTry;
            decoded = assDecoded;
            effectiveExtension = 'ass';
            await this.jobLogsService.append({
              jobId,
              level: 'info',
              phase: 'extracting',
              message:
                'ASS stream detected; using ASS pipeline to preserve styles and positioning',
              details: {},
            });
          } else {
            await fs.unlink(assTry.tempFilePath).catch(() => undefined);
          }
        } catch {
          /* keep SRT extraction */
        }
      }

      if (job.data.targetConflictResolution === 'replace') {
        const existingPath = this.outputService.buildSubtitlePath(
          item.path,
          job.data.targetLanguage,
          false,
          effectiveExtension,
          pathVariant,
        );
        await this.outputService.snapshotExistingIfAny(existingPath, item.id);
        await fs.unlink(existingPath).catch(() => undefined);
      }

      const settings = await this.settingsService.getSettings();
      let loggedFailedLines = 0;
      const MAX_FAILED_LINES_TO_LOG = 10;

      if (effectiveExtension === 'ass') {
        const assParser = new AssParser();
        const assBuilder = new AssBuilder();
        const assLines = assParser.parse(decoded);
        const dialogueTexts = assLines
          .filter((l) => l.kind === 'dialogue')
          .map((l) => l.text);
        if (dialogueTexts.length === 0) {
          throw new Error('No Dialogue lines in extracted ASS');
        }

        lastTranslatingProgress = 25;
        lastTranslatingMessage = `Translating ${dialogueTexts.length} subtitle lines`;
        await publish('translating', 25, lastTranslatingMessage);
        const translated = await this.translationService.translateLines(
          dialogueTexts,
          job.data.targetLanguage,
          settings.openRouterApiKey,
          settings.deepSeekApiKey,
          {
            provider: job.data.provider,
            sourceLanguage: job.data.sourceLanguage,
            verificationEnabled: settings.translationVerificationEnabled,
            onVerificationPhase: async (info) => {
              const progressPercent = info.phase === 'validating' ? 91 : 93;
              await publish(
                info.phase,
                progressPercent,
                info.message,
                info.details,
              );
            },
            onVerificationSummary: async (info) => {
              await publish(
                'validating',
                92,
                `Validation: ${info.successRate}% success rate (${info.failedCount}/${info.totalLines} failed)`,
                { countsByReason: info.countsByReason },
              );
            },
            onProgress: async (info) => {
              lastTranslatingProgress =
                25 + Math.floor((info.progressPercent / 100) * 65);
              lastTranslatingMessage = info.message;
              lastTranslatingDetails = info.details;
              await publish(
                'translating',
                lastTranslatingProgress,
                info.message,
                info.details,
              );
            },
            onTokenUpdate: async (info) => {
              await persistTokenUsageDelta(info);
              await publish(
                'translating',
                lastTranslatingProgress,
                lastTranslatingMessage,
                lastTranslatingDetails,
                {
                  promptTokens: info.promptTokens,
                  completionTokens: info.completionTokens,
                  totalTokens: info.totalTokens,
                  tierUsed: info.tierUsed,
                  estimatedCostUsd: info.estimatedCostUsd,
                },
              );
            },
            onLogFailedLine: async (failed) => {
              if (loggedFailedLines >= MAX_FAILED_LINES_TO_LOG) {
                return;
              }
              loggedFailedLines += 1;
              await this.jobLogsService.append({
                jobId,
                level: 'warn',
                phase: 'verification',
                message: `Line ${failed.index + 1} failed: ${failed.reason}${failed.detectedLanguage ? ` (detected: ${failed.detectedLanguage})` : ''}`,
                details: {
                  lineNumber: failed.index + 1,
                  source: failed.sourceText.substring(0, 150),
                  translated: failed.translatedText.substring(0, 150),
                  reason: failed.reason,
                  confidence: failed.confidence,
                },
              });
            },
          },
        );

        if (translated.verification) {
          await this.jobLogsService.append({
            jobId,
            level: translated.verification.failedCount > 0 ? 'warn' : 'info',
            phase: 'verification',
            message: `Translation verification: ${translated.verification.successRate}% success rate`,
            details: {
              totalLines: translated.verification.totalLines,
              passedLines: translated.verification.passedLines,
              failedCount: translated.verification.failedCount,
              retriedLines: translated.verification.retriedLines,
              fixedByRetry: translated.verification.fixedByRetry,
            },
          });
        }

        for (const warning of translated.warnings) {
          await this.jobLogsService.append({
            jobId,
            level: 'warn',
            phase: 'translating',
            message: warning,
          });
        }

        let dialogueIndex = 0;
        for (const line of assLines) {
          if (line.kind === 'dialogue') {
            line.text = translated.lines[dialogueIndex];
            dialogueIndex += 1;
            const progress =
              25 + Math.floor((dialogueIndex / dialogueTexts.length) * 65);
            void job.progress(progress);
          }
        }

        if (dialogueIndex !== translated.lines.length) {
          throw new Error('ASS translation line count mismatch');
        }

        await publish('writing', 92, 'Writing output subtitle file');
        const outputPath = await this.outputService.writeSubtitle(
          item.path,
          job.data.targetLanguage,
          assBuilder.build(assLines),
          false,
          effectiveExtension,
          pathVariant,
        );

        await this.jobLogsService.append({
          jobId,
          level: 'info',
          phase: 'completed',
          message: `Tier used: ${translated.tierUsed}. Tokens: ${translated.usage.totalTokens}`,
          details: {
            promptTokens: translated.usage.promptTokens,
            completionTokens: translated.usage.completionTokens,
            totalTokens: translated.usage.totalTokens,
          },
        });

        await fs.unlink(extraction.tempFilePath).catch(() => undefined);
        await publish('completed', 100, 'Translation completed', undefined, {
          promptTokens: translated.usage.promptTokens,
          completionTokens: translated.usage.completionTokens,
          totalTokens: translated.usage.totalTokens,
          tierUsed: translated.tierUsed,
          estimatedCostUsd: estimateDeepSeekCostUsd(
            lastPersistedPaid.promptTokens,
            lastPersistedPaid.completionTokens,
          ),
        });
        this.jobsEventsService.complete(jobId);

        const assReturn: JobReturnValue = {
          outputPath,
          tierUsed: translated.tierUsed,
          usage: translated.usage,
          lineCount: dialogueTexts.length,
        };
        await this.persistJobArchive(job, 'completed', assReturn);
        void this.telegramService.notifyJobCompleted(
          jobId,
          job.data,
          assReturn,
          job.timestamp,
        );
        void this.jellyfinService.refreshLibraryAfterSubtitle();
        return assReturn;
      }

      const parser = new SrtParser();
      const builder = new SrtBuilder();
      const cues = parser.parse(decoded);
      if (cues.length === 0) {
        throw new Error('Extracted subtitle track is empty');
      }

      lastTranslatingProgress = 25;
      lastTranslatingMessage = `Translating ${cues.length} subtitle lines`;
      await publish('translating', 25, lastTranslatingMessage);
      const translated = await this.translationService.translateLines(
        cues.map((cue) => cue.text),
        job.data.targetLanguage,
        settings.openRouterApiKey,
        settings.deepSeekApiKey,
        {
          provider: job.data.provider,
          sourceLanguage: job.data.sourceLanguage,
          verificationEnabled: settings.translationVerificationEnabled,
          onVerificationPhase: async (info) => {
            const progressPercent = info.phase === 'validating' ? 91 : 93;
            await publish(
              info.phase,
              progressPercent,
              info.message,
              info.details,
            );
          },
          onVerificationSummary: async (info) => {
            await publish(
              'validating',
              92,
              `Validation: ${info.successRate}% success rate (${info.failedCount}/${info.totalLines} failed)`,
              { countsByReason: info.countsByReason },
            );
          },
          onProgress: async (info) => {
            lastTranslatingProgress =
              25 + Math.floor((info.progressPercent / 100) * 65);
            lastTranslatingMessage = info.message;
            lastTranslatingDetails = info.details;
            await publish(
              'translating',
              lastTranslatingProgress,
              info.message,
              info.details,
            );
          },
          onTokenUpdate: async (info) => {
            await persistTokenUsageDelta(info);
            await publish(
              'translating',
              lastTranslatingProgress,
              lastTranslatingMessage,
              lastTranslatingDetails,
              {
                promptTokens: info.promptTokens,
                completionTokens: info.completionTokens,
                totalTokens: info.totalTokens,
                tierUsed: info.tierUsed,
                estimatedCostUsd: info.estimatedCostUsd,
              },
            );
          },
          onLogFailedLine: async (failed) => {
            if (loggedFailedLines >= MAX_FAILED_LINES_TO_LOG) {
              return;
            }
            loggedFailedLines += 1;
            await this.jobLogsService.append({
              jobId,
              level: 'warn',
              phase: 'verification',
              message: `Line ${failed.index + 1} failed: ${failed.reason}${failed.detectedLanguage ? ` (detected: ${failed.detectedLanguage})` : ''}`,
              details: {
                lineNumber: failed.index + 1,
                source: failed.sourceText.substring(0, 150),
                translated: failed.translatedText.substring(0, 150),
                reason: failed.reason,
                confidence: failed.confidence,
              },
            });
          },
        },
      );

      if (translated.verification) {
        await this.jobLogsService.append({
          jobId,
          level: translated.verification.failedCount > 0 ? 'warn' : 'info',
          phase: 'verification',
          message: `Translation verification: ${translated.verification.successRate}% success rate`,
          details: {
            totalLines: translated.verification.totalLines,
            passedLines: translated.verification.passedLines,
            failedCount: translated.verification.failedCount,
            retriedLines: translated.verification.retriedLines,
            fixedByRetry: translated.verification.fixedByRetry,
          },
        });
      }

      for (const warning of translated.warnings) {
        await this.jobLogsService.append({
          jobId,
          level: 'warn',
          phase: 'translating',
          message: warning,
        });
      }

      for (let index = 0; index < cues.length; index += 1) {
        cues[index].text = translated.lines[index];
        const progress = 25 + Math.floor(((index + 1) / cues.length) * 65);
        void job.progress(progress);
      }

      await publish('writing', 92, 'Writing output subtitle file');
      const outputPath = await this.outputService.writeSubtitle(
        item.path,
        job.data.targetLanguage,
        builder.build(cues),
        false,
        effectiveExtension,
        pathVariant,
      );

      await this.jobLogsService.append({
        jobId,
        level: 'info',
        phase: 'completed',
        message: `Tier used: ${translated.tierUsed}. Tokens: ${translated.usage.totalTokens}`,
        details: {
          promptTokens: translated.usage.promptTokens,
          completionTokens: translated.usage.completionTokens,
          totalTokens: translated.usage.totalTokens,
        },
      });

      await fs.unlink(extraction.tempFilePath).catch(() => undefined);
      await publish('completed', 100, 'Translation completed', undefined, {
        promptTokens: translated.usage.promptTokens,
        completionTokens: translated.usage.completionTokens,
        totalTokens: translated.usage.totalTokens,
        tierUsed: translated.tierUsed,
        estimatedCostUsd: estimateDeepSeekCostUsd(
          lastPersistedPaid.promptTokens,
          lastPersistedPaid.completionTokens,
        ),
      });
      this.jobsEventsService.complete(jobId);

      const srtReturn: JobReturnValue = {
        outputPath,
        tierUsed: translated.tierUsed,
        usage: translated.usage,
        lineCount: cues.length,
      };
      await this.persistJobArchive(job, 'completed', srtReturn);
      void this.telegramService.notifyJobCompleted(
        jobId,
        job.data,
        srtReturn,
        job.timestamp,
      );
      void this.jellyfinService.refreshLibraryAfterSubtitle();
      return srtReturn;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown failure';

      const stack = error instanceof Error ? error.stack : String(error);
      console.error(`[Job ${jobId}] Failed: ${message}`);
      console.error(stack);

      await this.persistJobArchive(job, 'failed', undefined, message);

      void this.telegramService.notifyJobFailed(jobId, job.data, message);

      await publish('failed', 100, message);
      this.jobsEventsService.complete(jobId);
      throw error;
    }
  }

  private async persistJobArchive(
    job: Job<TranslationJobPayload>,
    status: 'completed' | 'failed',
    returnValue?: JobReturnValue,
    failedReason?: string,
  ): Promise<void> {
    try {
      await this.jobArchiveService.appendSnapshot({
        id: String(job.id),
        state: status,
        data: job.data,
        createdAt: job.timestamp,
        processedAt: job.processedOn ?? undefined,
        finishedAt: Date.now(),
        progress: 100,
        returnValue,
        failedReason,
        logs: await this.jobLogsService.getByJob(String(job.id)),
      });
    } catch (err) {
      this.logger.error(
        `Failed to write job archive for ${String(job.id)}: ${err}`,
      );
    }
  }
}
