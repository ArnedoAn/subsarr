import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { ProviderLimiter, throwIfAborted } from './provider-limiter';
import type { ProviderUsage } from './translation.service';
import { isFreeOpenRouterModel } from '../settings/provider-pricing';
export type Provider = 'deepseek' | 'openrouter';
export interface ProviderRequest {
  provider: Provider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
  onUsage?: (usage: ProviderUsage) => void | Promise<void>;
  beforeRequest?: () => Promise<void>;
}
/** Shared SDK adapter: no SDK retries which could hide billable responses. */
export class ProviderAdapter {
  private readonly clients = new Map<string, OpenAI>();
  private readonly limiters: Record<Provider, ProviderLimiter> = {
    deepseek: new ProviderLimiter(5),
    openrouter: new ProviderLimiter(3),
  };
  async request(request: ProviderRequest): Promise<string> {
    throwIfAborted(request.signal);
    if (!request.apiKey.trim())
      throw new Error(`Missing ${request.provider} API key`);
    const baseURL =
      request.provider === 'deepseek'
        ? 'https://api.deepseek.com'
        : 'https://openrouter.ai/api/v1';
    const cacheKey = createHash('sha256')
      .update(baseURL)
      .update('\0')
      .update(request.apiKey.trim())
      .digest('hex');
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new OpenAI({
        baseURL,
        apiKey: request.apiKey.trim(),
        maxRetries: 0,
        timeout: 120000,
      });
      if (this.clients.size >= 8) {
        for (const oldestKey of this.clients.keys()) {
          this.clients.delete(oldestKey);
          break;
        }
      }
      this.clients.set(cacheKey, client);
    }
    const sdk = client;
    return this.limiters[request.provider].run(async () => {
      await request.beforeRequest?.();
      throwIfAborted(request.signal);
      const response = await sdk.chat.completions.create(
        {
          model: request.model,
          ...(request.provider === 'deepseek' ? { temperature: 1.3 } : {}),
          response_format: { type: 'json_object' },
          max_tokens: 8192,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        },
        { signal: request.signal },
      );
      const usage = response.usage;
      const details = usage as typeof usage & {
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
        cost?: unknown;
      };
      const hit =
        details?.prompt_cache_hit_tokens ??
        usage?.prompt_tokens_details?.cached_tokens ??
        0;
      const costUsd =
        typeof details?.cost === 'number' &&
        Number.isFinite(details.cost) &&
        details.cost >= 0
          ? details.cost
          : undefined;
      const tier =
        request.provider === 'deepseek' ||
        !isFreeOpenRouterModel(request.model) ||
        (costUsd ?? 0) > 0
          ? 'paid'
          : 'free';
      await request.onUsage?.({
        provider: request.provider,
        model: request.model,
        tier,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        cacheHitTokens: hit,
        cacheMissTokens:
          details?.prompt_cache_miss_tokens ??
          Math.max(0, (usage?.prompt_tokens ?? 0) - hit),
        ...(costUsd !== undefined ? { costUsd } : {}),
      });
      throwIfAborted(request.signal);
      if (response.choices[0]?.finish_reason !== 'stop')
        throw new Error('Provider output incomplete or refused');
      const content = response.choices[0]?.message.content;
      if (typeof content !== 'string')
        throw new Error('Provider returned no textual JSON content');
      return content;
    }, request.signal);
  }
  /** Daily free quota is distinct from transient minute/provider limits. */
  async canFallbackToDeepSeek(
    error: unknown,
    options: { model: string; apiKey: string; signal?: AbortSignal },
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    if (
      !isFreeOpenRouterModel(options.model) ||
      !error ||
      typeof error !== 'object' ||
      Array.isArray(error)
    )
      return false;
    const outer =
      'error' in error &&
      error.error !== null &&
      typeof error.error === 'object'
        ? error.error
        : error;
    const detail =
      'error' in outer &&
      outer.error !== null &&
      typeof outer.error === 'object'
        ? outer.error
        : outer;
    const status =
      'status' in error && typeof error.status === 'number'
        ? error.status
        : 'code' in detail
          ? detail.code
          : undefined;
    if (status !== 402 && status !== 429) return false;
    const metadata =
      'metadata' in detail &&
      detail.metadata !== null &&
      typeof detail.metadata === 'object'
        ? detail.metadata
        : {};
    const source =
      'limit_source' in metadata && typeof metadata.limit_source === 'string'
        ? metadata.limit_source
        : '';
    const reason =
      'reason' in metadata && typeof metadata.reason === 'string'
        ? metadata.reason
        : '';
    // Never bypass upstream limits, administrative caps or in-flight reservations.
    if (
      'provider_code' in metadata ||
      'provider_name' in metadata ||
      /provider|budget|minute|ddos|cloudflare/.test(source) ||
      [
        'openrouter_key_limit',
        'openrouter_guardrail_budget',
        'openrouter_workspace_budget',
      ].includes(source) ||
      reason === 'in_flight_budget_exhausted'
    )
      return false;
    const rawCode =
      'code' in detail ? detail.code : 'code' in error ? error.code : undefined;
    const code = typeof rawCode === 'string' ? rawCode : '';
    if (status === 402) {
      return (
        source === 'openrouter_credits' ||
        (!source &&
          [
            'insufficient_credits',
            'free_tier_exhausted',
            'insufficient_quota',
          ].includes(code))
      );
    }
    const message =
      'message' in detail && typeof detail.message === 'string'
        ? detail.message.toLowerCase()
        : '';
    const errorType =
      'error_type' in metadata && typeof metadata.error_type === 'string'
        ? metadata.error_type
        : '';
    if (
      /free-models-per-minute|requests?[-_ ]per[-_ ]minute|\bddos\b|cloudflare/.test(
        message,
      ) ||
      [
        'requests_per_minute',
        'minute_rate_limit_exceeded',
        'ddos_protection',
      ].includes(code) ||
      ['ddos_protection', 'provider_rate_limit_exceeded'].includes(errorType)
    )
      return false;
    const dailyCodes = [
      'free_model_daily_quota_exhausted',
      'free_model_daily_limit_exceeded',
      'free_model_daily_quota_exceeded',
      'free_daily_quota_exhausted',
      'daily_free_limit_exceeded',
    ];
    if (
      dailyCodes.includes(code) ||
      (/free-models-per-day|daily free(?:[- ]model)? (?:request )?(?:quota|limit)/.test(
        message,
      ) &&
        /exceeded|exhausted|reached/.test(message))
    )
      return true;
    if (!options.apiKey.trim()) return false;
    const timeout = AbortSignal.timeout(5000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      return await this.limiters.openrouter.run(async () => {
        const response = await fetch('https://openrouter.ai/api/v1/key', {
          headers: { Authorization: `Bearer ${options.apiKey.trim()}` },
          signal,
        });
        if (!response.ok) return false;
        const body: unknown = await response.json();
        throwIfAborted(signal);
        if (
          !body ||
          typeof body !== 'object' ||
          !('data' in body) ||
          !body.data ||
          typeof body.data !== 'object' ||
          !('free_model_daily_requests' in body.data)
        )
          return false;
        const daily = body.data.free_model_daily_requests;
        if (!daily || typeof daily !== 'object') return false;
        return (
          'used' in daily &&
          typeof daily.used === 'number' &&
          Number.isSafeInteger(daily.used) &&
          daily.used >= 0 &&
          'limit' in daily &&
          typeof daily.limit === 'number' &&
          Number.isSafeInteger(daily.limit) &&
          daily.limit >= 0 &&
          daily.used >= daily.limit &&
          'remaining' in daily &&
          typeof daily.remaining === 'number' &&
          Number.isSafeInteger(daily.remaining) &&
          daily.remaining <= 0
        );
      }, signal);
    } catch {
      throwIfAborted(options.signal);
      return false;
    }
  }
}
