import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { OpenRouter } from '@openrouter/sdk';
import type { ChatCompletion } from 'openai/resources';

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

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private consecutiveOpenRouterFailures = 0;

  constructor() {}

  private async runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let i = 0;

    const worker = async () => {
      while (i < tasks.length) {
        const index = i++;
        results[index] = await tasks[index]();
      }
    };

    await Promise.all(
      Array(Math.min(concurrency, tasks.length)).fill(0).map(() => worker())
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
      onProgress?: (info: {
        batchIndex: number;
        totalBatches: number;
        progressPercent: number;
        message: string;
        details?: any;
      }) => void;
    }
  ): Promise<TranslationResult> {
    const output = [...lines];
    let tierUsed: TranslationTier = options?.provider === 'deepseek' ? 'paid' : 'free';
    let promptTokens = 0;
    let completionTokens = 0;
    const warnings: string[] = [];

    const totalBatches = Math.ceil(lines.length / (BATCH_SIZE - OVERLAP_SIZE));
    let batchIndex = 0;

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
          options.onProgress({
            batchIndex: currentBatchIndex,
            totalBatches,
            progressPercent: Math.floor((currentBatchIndex / totalBatches) * 100),
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
          options?.provider
        );

        return { start, result };
      });
    }

    // Process tasks with controlled concurrency (e.g., 5 concurrent requests)
    const concurrency = options?.provider === 'openrouter' ? 3 : 5;
    const results = await this.runWithConcurrency(tasks, concurrency);

    for (const { start, result } of results) {
      const effectiveStart = start === 0 ? 0 : OVERLAP_SIZE;
      const toApply = result.translated.slice(effectiveStart);

      for (let index = 0; index < toApply.length; index += 1) {
        output[start + effectiveStart + index] = toApply[index];
      }

      if (result.tierUsed === 'paid') {
        tierUsed = 'paid';
      }

      promptTokens += result.usage.promptTokens;
      completionTokens += result.usage.completionTokens;

      if (result.warning) {
        warnings.push(result.warning);
      }
    }

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

  private async translateBatch(
    batch: string[],
    batchStart: number,
    targetLanguage: string,
    openRouterApiKey: string,
    deepSeekApiKey: string,
    provider?: 'openrouter' | 'deepseek',
  ): Promise<BatchResult> {
    const firstAttempt = await this.callLLM(
      batch,
      targetLanguage,
      openRouterApiKey,
      deepSeekApiKey,
      provider,
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
    provider?: 'openrouter' | 'deepseek',
  ): Promise<BatchResult> {
    if (provider === 'deepseek') {
      return await this.callDeepSeek(batch, targetLanguage, deepSeekApiKey);
    }

    try {
      return await this.callOpenRouter(batch, targetLanguage, openRouterApiKey);
    } catch (error) {
      if (this.isExhaustedError(error)) {
        this.logger.warn(
          'OpenRouter free tier exhausted - falling back to DeepSeek',
        );
        return await this.callDeepSeek(batch, targetLanguage, deepSeekApiKey);
      }

      throw error;
    }
  }

  private async callOpenRouter(
    batch: string[],
    targetLanguage: string,
    apiKey: string,
  ): Promise<BatchResult> {
    const client = new OpenRouter({ apiKey });

    try {
      const response = await client.chat.send({
        chatGenerationParams: {
          model: 'openrouter/free',
          responseFormat: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `Translate to ${targetLanguage}. Output strictly JSON object: {"data":["translated1",...]}. Keep exact array length.`,
            },
            {
              role: 'user',
              content: JSON.stringify(batch),
            },
          ],
        },
      });

      this.consecutiveOpenRouterFailures = 0;
      
      const content =
        response.choices?.[0]?.message?.content ?? '[]';

      return this.validateAndMapResponse(
        batch,
        content,
        {
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
          totalTokens: response.usage?.totalTokens ?? 0,
        },
        'free',
      );
    } catch (error) {
      this.consecutiveOpenRouterFailures += 1;
      throw error;
    }
  }

  private async callDeepSeek(
    batch: string[],
    targetLanguage: string,
    apiKey: string,
  ): Promise<BatchResult> {
    const client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: apiKey.trim(),
    });

    const response = (await client.chat.completions.create({
      model: 'deepseek-chat',
      temperature: 1.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Translate to ${targetLanguage}. Output strictly JSON object: {"data":["translated1",...]}. Keep exact array length.`,
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
      arrayData = (parsed as any).data || (parsed as any).translations || Object.values(parsed)[0];
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
