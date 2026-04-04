import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { type Job } from 'bull';
import { promises as fs } from 'node:fs';
import * as jschardet from 'jschardet';
import iconv from 'iconv-lite';
import { ExtractionService } from '../extraction/extraction.service';
import { type JobReturnValue, type TranslationJobPayload } from './jobs.types';
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
  ) {}

  @Process({ concurrency: Number(process.env.SUBSYNC_CONCURRENCY ?? 2) })
  async handle(job: Job<TranslationJobPayload>) {
    const jobId = String(job.id);
    const outputExtension: SubtitleOutputExtension =
      job.data.outputExtension ?? 'srt';
    const pathVariant: SubtitlePathVariant =
      job.data.targetConflictResolution === 'alternate'
        ? 'alternate'
        : 'default';

    const publish = (
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
    ) => {
      this.jobsEventsService.publish(jobId, {
        phase,
        progressPercent,
        message,
        timestamp: new Date().toISOString(),
        details,
      });
      void job.progress(progressPercent);

      this.jobLogsService.append({
        jobId,
        level: phase === 'failed' ? 'error' : 'info',
        phase,
        message,
        details,
      });
    };

    try {
      publish('active', 0, 'Job started');

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

      publish('extracting', 10, 'Extracting subtitle track');
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
            this.jobLogsService.append({
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

        publish(
          'translating',
          25,
          `Translating ${dialogueTexts.length} subtitle lines`,
        );
        const translated = await this.translationService.translateLines(
          dialogueTexts,
          job.data.targetLanguage,
          settings.openRouterApiKey,
          settings.deepSeekApiKey,
          {
            provider: job.data.provider,
            sourceLanguage: job.data.sourceLanguage,
            verificationEnabled: settings.translationVerificationEnabled,
            onVerificationPhase: (info) => {
              const progressPercent = info.phase === 'validating' ? 91 : 93;
              publish(info.phase, progressPercent, info.message, info.details);
            },
            onVerificationSummary: (info) => {
              publish(
                'validating',
                92,
                `Validation: ${info.successRate}% success rate (${info.failedCount}/${info.totalLines} failed)`,
                { countsByReason: info.countsByReason },
              );
            },
            onProgress: (info) => {
              const overallProgress =
                25 + Math.floor((info.progressPercent / 100) * 65);
              publish(
                'translating',
                overallProgress,
                info.message,
                info.details,
              );
            },
            onLogFailedLine: (failed) => {
              if (loggedFailedLines >= MAX_FAILED_LINES_TO_LOG) {
                return;
              }
              loggedFailedLines += 1;
              this.jobLogsService.append({
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
          this.jobLogsService.append({
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
          this.jobLogsService.append({
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

        publish('writing', 92, 'Writing output subtitle file');
        const outputPath = await this.outputService.writeSubtitle(
          item.path,
          job.data.targetLanguage,
          assBuilder.build(assLines),
          false,
          effectiveExtension,
          pathVariant,
        );

        this.tokenUsageService.addUsage(translated.tierUsed, translated.usage);

        this.jobLogsService.append({
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
        publish('completed', 100, 'Translation completed');
        this.jobsEventsService.complete(jobId);

        const assReturn: JobReturnValue = {
          outputPath,
          tierUsed: translated.tierUsed,
          usage: translated.usage,
          lineCount: dialogueTexts.length,
        };
        await this.persistJobArchive(job, 'completed', assReturn);
        return assReturn;
      }

      const parser = new SrtParser();
      const builder = new SrtBuilder();
      const cues = parser.parse(decoded);
      if (cues.length === 0) {
        throw new Error('Extracted subtitle track is empty');
      }

      publish('translating', 25, `Translating ${cues.length} subtitle lines`);
      const translated = await this.translationService.translateLines(
        cues.map((cue) => cue.text),
        job.data.targetLanguage,
        settings.openRouterApiKey,
        settings.deepSeekApiKey,
        {
          provider: job.data.provider,
          sourceLanguage: job.data.sourceLanguage,
          verificationEnabled: settings.translationVerificationEnabled,
          onVerificationPhase: (info) => {
            const progressPercent = info.phase === 'validating' ? 91 : 93;
            publish(info.phase, progressPercent, info.message, info.details);
          },
          onVerificationSummary: (info) => {
            publish(
              'validating',
              92,
              `Validation: ${info.successRate}% success rate (${info.failedCount}/${info.totalLines} failed)`,
              { countsByReason: info.countsByReason },
            );
          },
          onProgress: (info) => {
            const overallProgress =
              25 + Math.floor((info.progressPercent / 100) * 65);
            publish('translating', overallProgress, info.message, info.details);
          },
          onLogFailedLine: (failed) => {
            if (loggedFailedLines >= MAX_FAILED_LINES_TO_LOG) {
              return;
            }
            loggedFailedLines += 1;
            this.jobLogsService.append({
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
        this.jobLogsService.append({
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
        this.jobLogsService.append({
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

      publish('writing', 92, 'Writing output subtitle file');
      const outputPath = await this.outputService.writeSubtitle(
        item.path,
        job.data.targetLanguage,
        builder.build(cues),
        false,
        effectiveExtension,
        pathVariant,
      );

      this.tokenUsageService.addUsage(translated.tierUsed, translated.usage);

      this.jobLogsService.append({
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
      publish('completed', 100, 'Translation completed');
      this.jobsEventsService.complete(jobId);

      const srtReturn: JobReturnValue = {
        outputPath,
        tierUsed: translated.tierUsed,
        usage: translated.usage,
        lineCount: cues.length,
      };
      await this.persistJobArchive(job, 'completed', srtReturn);
      return srtReturn;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown failure';

      const stack = error instanceof Error ? error.stack : String(error);
      console.error(`[Job ${jobId}] Failed: ${message}`);
      console.error(stack);

      await this.persistJobArchive(job, 'failed', undefined, message);

      publish('failed', 100, message);
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
        logs: this.jobLogsService.getByJob(String(job.id)),
      });
    } catch (err) {
      this.logger.error(
        `Failed to write job archive for ${String(job.id)}: ${err}`,
      );
    }
  }
}
