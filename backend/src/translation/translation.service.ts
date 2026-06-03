import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources';
import {
  TranslationVerificationService,
  type FailedLine,
  type SubtitleFormat,
} from './translation-verification.service';
import { SettingsService } from '../settings/settings.service';
import { estimateDeepSeekCostUsd } from '../settings/deepseek-pricing';

export type TranslationTier = 'free' | 'paid';

export interface TranslationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TranslationResult {
  lines: string[];
  tierUsed: TranslationTier;
  usage: TranslationUsage;
  warnings: string[];
  verification?: {
    totalLines: number;
    passedLines: number;
    failedCount: number;
    successRate: number;
    retriedLines: number;
    fixedByRetry: number;
  };
}

interface BatchResult {
  translated: string[];
  usage: TranslationUsage;
  tierUsed: TranslationTier;
  warning?: string;
}

const BATCH_SIZE = 60;
const OVERLAP_SIZE = 2;
const EXHAUSTION_FAILURE_LIMIT = 3;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private consecutiveOpenRouterFailures = 0;

  constructor(
    private readonly verificationService: TranslationVerificationService,
    private readonly settingsService: SettingsService,
  ) {}

  private async runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number,
  ): Promise<T[]> {
    const results: T[] = [];
    results.length = tasks.length;
    let i = 0;

    const worker = async () => {
      while (i < tasks.length) {
        const index = i++;
        results[index] = await tasks[index]();
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
        worker(),
      ),
    );

    return results;
  }

  async translateLines(
    lines: string[],
    targetLanguage: string,
    openRouterApiKey: string,
    deepSeekApiKey: string,
    options?: {
      provider?: 'openrouter' | 'deepseek';
      sourceLanguage?: string;
      verificationEnabled?: boolean;
      onVerificationPhase?: (info: {
        phase: 'validating' | 'correcting';
        message: string;
        details?: any;
      }) => void | Promise<void>;
      onVerificationSummary?: (info: {
        successRate: number;
        failedCount: number;
        totalLines: number;
        countsByReason: Record<string, number>;
      }) => void | Promise<void>;
      onProgress?: (info: {
        batchIndex: number;
        totalBatches: number;
        progressPercent: number;
        message: string;
        details?: any;
      }) => void | Promise<void>;
      /** Fires after each translation batch completes (serialized); includes cumulative totals. */
      onTokenUpdate?: (info: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        tierUsed: TranslationTier;
        estimatedCostUsd: number;
        usageByTier: Record<TranslationTier, TranslationUsage>;
      }) => void | Promise<void>;
      onLogFailedLine?: (line: FailedLine) => void | Promise<void>;
      /** Extra system instructions (e.g. glossary). */
      glossaryHint?: string;
      subtitleFormat?: SubtitleFormat;
    },
  ): Promise<TranslationResult> {
    const settings = await this.settingsService.getSettings();
    const llmModels = {
      openRouter: settings.openRouterModel,
      deepSeek: settings.deepSeekModel,
    };

    const output = [...lines];
    let tierUsed: TranslationTier =
      options?.provider === 'deepseek' ? 'paid' : 'free';
    const warnings: string[] = [];

    const usageByTier: Record<TranslationTier, TranslationUsage> = {
      free: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      paid: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    let tokenNotifyChain: Promise<void> = Promise.resolve();

    const emitTokenUpdate = (): Promise<void> => {
      if (!options?.onTokenUpdate) {
        return Promise.resolve();
      }
      const { free, paid } = usageByTier;
      const promptTokensAcc = free.promptTokens + paid.promptTokens;
      const completionTokensAcc = free.completionTokens + paid.completionTokens;
      return Promise.resolve(
        options.onTokenUpdate({
          promptTokens: promptTokensAcc,
          completionTokens: completionTokensAcc,
          totalTokens: promptTokensAcc + completionTokensAcc,
          tierUsed: paid.totalTokens > 0 ? 'paid' : 'free',
          estimatedCostUsd: estimateDeepSeekCostUsd(
            paid.promptTokens,
            paid.completionTokens,
          ),
          usageByTier: {
            free: { ...free },
            paid: { ...paid },
          },
        }),
      );
    };

    /** Serialize usage mutations (concurrent batches) and optionally notify. */
    const scheduleTokenUpdateFromBatch = (result: BatchResult): void => {
      const tier = result.tierUsed;
      const u = result.usage;
      tokenNotifyChain = tokenNotifyChain.then(async () => {
        usageByTier[tier].promptTokens += u.promptTokens;
        usageByTier[tier].completionTokens += u.completionTokens;
        usageByTier[tier].totalTokens += u.totalTokens;
        await emitTokenUpdate();
      });
    };

    const totalBatches = Math.ceil(lines.length / (BATCH_SIZE - OVERLAP_SIZE));
    let batchIndex = 0;
    const glossaryHint = options?.glossaryHint?.trim()
      ? `${options.glossaryHint.trim()}\n\n`
      : '';

    const tasks = [];

    for (
      let start = 0;
      start < lines.length;
      start += BATCH_SIZE - OVERLAP_SIZE
    ) {
      const currentBatchIndex = ++batchIndex;
      const end = Math.min(start + BATCH_SIZE, lines.length);
      const slice = lines.slice(start, end);

      tasks.push(async () => {
        if (options?.onProgress) {
          await options.onProgress({
            batchIndex: currentBatchIndex,
            totalBatches,
            progressPercent: Math.floor(
              (currentBatchIndex / totalBatches) * 100,
            ),
            message: `Translating batch ${currentBatchIndex} of ${totalBatches} (${slice.length} lines)`,
            details: { start, end, lines: slice.length },
          });
        }

        const result = await this.translateBatch(
          slice,
          start,
          targetLanguage,
          openRouterApiKey,
          deepSeekApiKey,
          options?.provider,
          llmModels,
          glossaryHint,
          options?.subtitleFormat,
        );

        scheduleTokenUpdateFromBatch(result);

        return { start, result };
      });
    }

    // Process tasks with controlled concurrency (e.g., 5 concurrent requests)
    const concurrency = options?.provider === 'openrouter' ? 3 : 5;
    const results = await this.runWithConcurrency(tasks, concurrency);
    await tokenNotifyChain;

    for (const { start, result } of results) {
      const effectiveStart = start === 0 ? 0 : OVERLAP_SIZE;
      const toApply = result.translated.slice(effectiveStart);

      for (let index = 0; index < toApply.length; index += 1) {
        output[start + effectiveStart + index] = toApply[index];
      }

      if (result.tierUsed === 'paid') {
        tierUsed = 'paid';
      }

      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    const promptTokens =
      usageByTier.free.promptTokens + usageByTier.paid.promptTokens;
    const completionTokens =
      usageByTier.free.completionTokens + usageByTier.paid.completionTokens;

    const semanticChecksEnabled = options?.verificationEnabled ?? false;
    const shouldVerify =
      semanticChecksEnabled || Boolean(options?.subtitleFormat);

    if (!shouldVerify) {
      return {
        lines: output,
        tierUsed,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        warnings,
      };
    }

    const verificationOptions = options ?? {};
    const sourceLanguage = verificationOptions.sourceLanguage ?? 'eng';
    if (verificationOptions.onVerificationPhase) {
      await verificationOptions.onVerificationPhase({
        phase: 'validating',
        message: 'Validating translation',
        details: { totalLines: lines.length },
      });
    }
    const verification = this.verificationService.verifyTranslation(
      lines,
      output,
      sourceLanguage,
      targetLanguage,
      {
        subtitleFormat: options?.subtitleFormat,
        semanticChecksEnabled,
      },
    );

    if (verificationOptions.onVerificationSummary) {
      const countsByReason: Record<string, number> = {};
      for (const failed of verification.failedLines) {
        countsByReason[failed.reason] =
          (countsByReason[failed.reason] ?? 0) + 1;
      }
      await verificationOptions.onVerificationSummary({
        successRate: verification.successRate,
        failedCount: verification.failedLines.length,
        totalLines: lines.length,
        countsByReason,
      });
    }

    let retriedLines = 0;
    let fixedByRetry = 0;

    if (verification.failedLines.length > 0) {
      this.logger.warn(
        `Translation verification: ${verification.successRate}% success rate, ${verification.failedLines.length} failed lines`,
      );
      this.verificationService.logFailedLines(
        verification.failedLines,
        (message) => this.logger.warn(message),
      );

      const MAX_RETRIES_PER_LINE = 2;
      retriedLines = verification.failedLines.length;

      if (verificationOptions.onVerificationPhase) {
        await verificationOptions.onVerificationPhase({
          phase: 'correcting',
          message: `Correcting ${verification.failedLines.length} failed line(s)`,
          details: { failedCount: verification.failedLines.length },
        });
      }

      for (const failed of verification.failedLines) {
        if (verificationOptions.onLogFailedLine) {
          await verificationOptions.onLogFailedLine(failed);
        }

        let retrySuccess = false;
        for (
          let attempt = 1;
          attempt <= MAX_RETRIES_PER_LINE && !retrySuccess;
          attempt++
        ) {
          try {
            const singleResult = await this.callLLM(
              [lines[failed.index]],
              targetLanguage,
              openRouterApiKey,
              deepSeekApiKey,
              verificationOptions.provider,
              llmModels,
              glossaryHint,
              verificationOptions.subtitleFormat,
              this.buildCorrectionHint(
                failed,
                verificationOptions.subtitleFormat,
              ),
            );

            if (singleResult.translated.length === 1) {
              const newTranslation = singleResult.translated[0];
              const singleVerification =
                this.verificationService.verifyTranslation(
                  [lines[failed.index]],
                  [newTranslation],
                  sourceLanguage,
                  targetLanguage,
                  {
                    subtitleFormat: verificationOptions.subtitleFormat,
                    semanticChecksEnabled,
                  },
                );

              if (singleVerification.failedLines.length === 0) {
                output[failed.index] = newTranslation;
                retrySuccess = true;
                fixedByRetry++;
                const st = singleResult.tierUsed;
                usageByTier[st].promptTokens += singleResult.usage.promptTokens;
                usageByTier[st].completionTokens +=
                  singleResult.usage.completionTokens;
                usageByTier[st].totalTokens += singleResult.usage.totalTokens;
                if (singleResult.tierUsed === 'paid') tierUsed = 'paid';
                await emitTokenUpdate();
                this.logger.log(
                  `Line ${failed.index + 1} re-translated successfully on attempt ${attempt}`,
                );
              }
            }
          } catch (err) {
            this.logger.warn(
              `Re-translation attempt ${attempt} failed for line ${failed.index + 1}: ${err}`,
            );
          }
        }

        if (!retrySuccess) {
          this.logger.warn(
            `Line ${failed.index + 1} still failed after ${MAX_RETRIES_PER_LINE} retries`,
          );
        }
      }
    }

    const finalFailedCount = verification.failedLines.length - fixedByRetry;
    const finalPassedLines = lines.length - finalFailedCount;

    const finalPrompt =
      usageByTier.free.promptTokens + usageByTier.paid.promptTokens;
    const finalCompletion =
      usageByTier.free.completionTokens + usageByTier.paid.completionTokens;

    return {
      lines: output,
      tierUsed,
      usage: {
        promptTokens: finalPrompt,
        completionTokens: finalCompletion,
        totalTokens: finalPrompt + finalCompletion,
      },
      warnings,
      verification: {
        totalLines: lines.length,
        passedLines: finalPassedLines,
        failedCount: finalFailedCount,
        successRate:
          lines.length > 0
            ? Math.round((finalPassedLines / lines.length) * 10000) / 100
            : 100,
        retriedLines,
        fixedByRetry,
      },
    };
  }

  private async translateBatch(
    batch: string[],
    batchStart: number,
    targetLanguage: string,
    openRouterApiKey: string,
    deepSeekApiKey: string,
    provider: 'openrouter' | 'deepseek' | undefined,
    llmModels: { openRouter: string; deepSeek: string },
    glossaryHint: string,
    subtitleFormat?: SubtitleFormat,
  ): Promise<BatchResult> {
    const firstAttempt = await this.callLLM(
      batch,
      targetLanguage,
      openRouterApiKey,
      deepSeekApiKey,
      provider,
      llmModels,
      glossaryHint,
      subtitleFormat,
    );
    if (this.isValidBatchLength(batch, firstAttempt.translated)) {
      return firstAttempt;
    }

    const retryAttempt = await this.callLLM(
      batch,
      targetLanguage,
      openRouterApiKey,
      deepSeekApiKey,
      provider,
      llmModels,
      glossaryHint,
      subtitleFormat,
    );
    if (this.isValidBatchLength(batch, retryAttempt.translated)) {
      return retryAttempt;
    }

    return {
      translated: [...batch],
      usage: {
        promptTokens:
          firstAttempt.usage.promptTokens + retryAttempt.usage.promptTokens,
        completionTokens:
          firstAttempt.usage.completionTokens +
          retryAttempt.usage.completionTokens,
        totalTokens:
          firstAttempt.usage.totalTokens + retryAttempt.usage.totalTokens,
      },
      tierUsed: retryAttempt.tierUsed,
      warning: `Batch starting at line ${batchStart + 1} failed validation twice; original lines preserved`,
    };
  }

  private async callLLM(
    batch: string[],
    targetLanguage: string,
    openRouterApiKey: string,
    deepSeekApiKey: string,
    provider: 'openrouter' | 'deepseek' | undefined,
    llmModels: { openRouter: string; deepSeek: string },
    glossaryHint: string,
    subtitleFormat?: SubtitleFormat,
    correctionHint?: string,
  ): Promise<BatchResult> {
    if (provider === 'deepseek') {
      return await this.callDeepSeek(
        batch,
        targetLanguage,
        deepSeekApiKey,
        llmModels.deepSeek,
        glossaryHint,
        subtitleFormat,
        correctionHint,
      );
    }

    try {
      return await this.callOpenRouter(
        batch,
        targetLanguage,
        openRouterApiKey,
        llmModels.openRouter,
        glossaryHint,
        subtitleFormat,
        correctionHint,
      );
    } catch (error) {
      if (this.isExhaustedError(error)) {
        this.logger.warn(
          'OpenRouter free tier exhausted - falling back to DeepSeek',
        );
        return await this.callDeepSeek(
          batch,
          targetLanguage,
          deepSeekApiKey,
          llmModels.deepSeek,
          glossaryHint,
          subtitleFormat,
          correctionHint,
        );
      }

      throw error;
    }
  }

  private async callOpenRouter(
    batch: string[],
    targetLanguage: string,
    apiKey: string,
    model: string,
    glossaryHint: string,
    subtitleFormat?: SubtitleFormat,
    correctionHint?: string,
  ): Promise<BatchResult> {
    try {
      const httpResponse = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: this.buildSystemPrompt(
                targetLanguage,
                glossaryHint,
                subtitleFormat,
                correctionHint,
              ),
            },
            {
              role: 'user',
              content: JSON.stringify(batch),
            },
          ],
        }),
      });

      const rawText = await httpResponse.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        throw new Error(
          `OpenRouter returned non-JSON (HTTP ${httpResponse.status}): ${rawText.slice(0, 300)}`,
        );
      }

      const body = parsed as Record<string, unknown>;

      if (!httpResponse.ok) {
        const errDetail =
          typeof body.error === 'object' && body.error !== null
            ? JSON.stringify(body.error)
            : typeof body.error === 'string'
              ? body.error
              : rawText.slice(0, 400);
        throw new Error(`OpenRouter HTTP ${httpResponse.status}: ${errDetail}`);
      }

      const choices = body.choices as
        | Array<Record<string, unknown>>
        | undefined;
      const message = choices?.[0]?.message as
        | Record<string, unknown>
        | undefined;
      let content = '';
      const rawContent = message?.content;
      if (typeof rawContent === 'string') {
        content = rawContent;
      } else if (Array.isArray(rawContent)) {
        content = rawContent
          .map((part: unknown) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && 'text' in part) {
              return String((part as { text?: string }).text ?? '');
            }
            return '';
          })
          .join('');
      }

      const usageRaw = body.usage as Record<string, unknown> | undefined;
      const usage = {
        promptTokens: Number(usageRaw?.prompt_tokens ?? 0),
        completionTokens: Number(usageRaw?.completion_tokens ?? 0),
        totalTokens: Number(usageRaw?.total_tokens ?? 0),
      };

      this.consecutiveOpenRouterFailures = 0;

      return this.validateAndMapResponse(batch, content || '[]', usage, 'free');
    } catch (error) {
      this.consecutiveOpenRouterFailures += 1;
      throw error;
    }
  }

  private async callDeepSeek(
    batch: string[],
    targetLanguage: string,
    apiKey: string,
    model: string,
    glossaryHint: string,
    subtitleFormat?: SubtitleFormat,
    correctionHint?: string,
  ): Promise<BatchResult> {
    const client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: apiKey.trim(),
    });

    const response = (await client.chat.completions.create({
      model,
      temperature: 1.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt(
            targetLanguage,
            glossaryHint,
            subtitleFormat,
            correctionHint,
          ),
        },
        {
          role: 'user',
          content: JSON.stringify(batch),
        },
      ],
    })) as ChatCompletion;

    return this.validateAndMapResponse(
      batch,
      response.choices[0]?.message?.content ?? '[]',
      {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      'paid',
    );
  }

  private validateAndMapResponse(
    input: string[],
    content: string,
    usage: TranslationUsage,
    tierUsed: TranslationTier,
  ): BatchResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }

    let arrayData = parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parsedRecord = parsed as Record<string, unknown>;
      arrayData =
        parsedRecord.data ??
        parsedRecord.translations ??
        Object.values(parsedRecord)[0];
    }

    if (!Array.isArray(arrayData)) {
      return {
        translated: [...input],
        usage,
        tierUsed,
      };
    }

    const translated = arrayData.map((entry) =>
      typeof entry === 'string' ? entry : JSON.stringify(entry),
    );

    if (!this.isValidBatchLength(input, translated)) {
      return {
        translated,
        usage,
        tierUsed,
      };
    }

    return {
      translated,
      usage,
      tierUsed,
    };
  }

  private isValidBatchLength(input: string[], translated: string[]): boolean {
    return translated.length === input.length;
  }

  private buildSystemPrompt(
    targetLanguage: string,
    glossaryHint: string,
    subtitleFormat?: SubtitleFormat,
    correctionHint?: string,
  ): string {
    const formatRules =
      subtitleFormat === 'srt'
        ? 'Preserve internal newline characters inside each subtitle cue. Do not merge, drop, split, or reorder cue segments.'
        : subtitleFormat === 'ass'
          ? 'Preserve ASS override tags like {\\i1} and line break markers like \\N exactly. Translate only human-readable dialogue text.'
          : 'Do not merge, drop, split, or reorder input items.';

    const correction = correctionHint ? `\n${correctionHint}` : '';

    return `${glossaryHint}Translate to ${targetLanguage}. Output strictly JSON object: {"data":["translated1",...]}. Keep exact array length. ${formatRules}${correction}`;
  }

  private buildCorrectionHint(
    failed: FailedLine,
    subtitleFormat?: SubtitleFormat,
  ): string {
    const formatHint =
      subtitleFormat === 'ass'
        ? 'Keep every ASS tag and \\N marker from the source.'
        : subtitleFormat === 'srt'
          ? 'Keep the same internal newline structure as the source cue.'
          : 'Keep the full source cue represented in one translated output item.';

    return `Previous translation failed validation with reason "${failed.reason}". Re-translate the full cue completely. ${formatHint}`;
  }

  private isExhaustedError(error: unknown): boolean {
    if (this.consecutiveOpenRouterFailures >= EXHAUSTION_FAILURE_LIMIT) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const statusCode =
      'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 'status' in error
          ? Number((error as { status?: unknown }).status)
          : undefined;
    if (statusCode === 429) {
      const retryAfter =
        'headers' in error
          ? ((error as { headers?: Record<string, string> }).headers?.[
              'retry-after'
            ] ?? '')
          : '';
      if (!retryAfter) {
        return true;
      }

      const message = error.message.toLowerCase();
      return (
        message.includes('no free') ||
        message.includes('no models') ||
        message.includes('rate limit')
      );
    }

    return error.message.toLowerCase().includes('openrouter');
  }
}
