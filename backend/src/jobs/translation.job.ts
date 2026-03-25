import { Processor, Process } from '@nestjs/bull';
import { type Job } from 'bull';
import { promises as fs } from 'node:fs';
import * as jschardet from 'jschardet';
import iconv from 'iconv-lite';
import { ExtractionService } from '../extraction/extraction.service';
import { type TranslationJobPayload } from './jobs.types';
import { LibraryService } from '../library/library.service';
import { RulesService } from '../rules/rules.service';
import { SettingsService } from '../settings/settings.service';
import { SrtParser } from '../translation/srt-parser';
import { SrtBuilder } from '../translation/srt-builder';
import { TranslationService } from '../translation/translation.service';
import { OutputService } from '../output/output.service';
import { JobsEventsService } from './jobs-events.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { JobLogsService } from './job-logs.service';

@Processor('translation')
export class TranslationJobProcessor {
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
  ) {}

  @Process({ concurrency: Number(process.env.SUBSYNC_CONCURRENCY ?? 2) })
  async handle(job: Job<TranslationJobPayload>) {
    const jobId = String(job.id);
    const parser = new SrtParser();
    const builder = new SrtBuilder();

    const publish = (
      phase:
        | 'active'
        | 'extracting'
        | 'translating'
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
      const extraction = await this.extractionService.extractSubtitleTrack(
        item.path,
        job.data.sourceTrackIndex,
      );

      const rawBuffer = await fs.readFile(extraction.tempFilePath);
      const detection = jschardet.detect(rawBuffer);
      const decoded = detection.encoding
        ? iconv.decode(rawBuffer, detection.encoding)
        : rawBuffer.toString('utf8');
      const cues = parser.parse(decoded);
      if (cues.length === 0) {
        throw new Error('Extracted subtitle track is empty');
      }

      publish('translating', 25, `Translating ${cues.length} subtitle lines`);
      const settings = await this.settingsService.getSettings();
      const lines = cues.map((cue) => cue.text);
      const translated = await this.translationService.translateLines(
        lines,
        job.data.targetLanguage,
        settings.openRouterApiKey,
        settings.deepSeekApiKey,
        {
          provider: job.data.provider,
          onProgress: (info) => {
            const overallProgress = 25 + Math.floor((info.progressPercent / 100) * 65);
            publish('translating', overallProgress, info.message, info.details);
          },
        }
      );

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

      return {
        outputPath,
        tierUsed: translated.tierUsed,
        usage: translated.usage,
        lineCount: cues.length,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown failure';
      
      const stack = error instanceof Error ? error.stack : String(error);
      console.error(`[Job ${jobId}] Failed: ${message}`);
      console.error(stack);
      
      publish('failed', 100, message);
      this.jobsEventsService.complete(jobId);
      throw error;
    }
  }
}
