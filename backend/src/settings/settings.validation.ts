import { BadRequestException } from '@nestjs/common';
import { CronTime } from 'cron';
import {
  assertWithinMediaRoots,
  validateLanguageCode,
} from '../common/path-safety';
import type { RuntimeSettings } from './settings.types';
import { SECRET_FIELDS, isMaskedSecret } from './secret-store';

import { canonicalizeLanguage } from '../common/language.utils';
export async function validateSettings(
  settings: RuntimeSettings,
  trustedRoots?: string[],
): Promise<RuntimeSettings> {
  const fail = (message: string): never => {
    throw new BadRequestException(message);
  };
  const list = (
    value: unknown,
    name: string,
    max: number,
    maxLength = 4096,
  ): string[] => {
    if (
      !Array.isArray(value) ||
      value.length > max ||
      value.some(
        (entry: unknown) =>
          typeof entry !== 'string' ||
          !entry.trim() ||
          entry.length > maxLength ||
          entry.includes('\0'),
      )
    )
      return fail(`${name} is invalid or too large`);
    return value as string[];
  };
  const number = (
    value: unknown,
    name: string,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isSafeInteger(value))
    )
      fail(`${name} must be between ${min} and ${max}`);
  };
  list(settings.mediaDirs, 'mediaDirs', 32);
  if (!settings.mediaDirs.length)
    fail('At least one media directory is required');
  if (trustedRoots) {
    try {
      settings.mediaDirs = await Promise.all(
        settings.mediaDirs.map((root) =>
          assertWithinMediaRoots(root, trustedRoots, { allowMissing: true }),
        ),
      );
    } catch {
      fail('Outside trusted roots or inaccessible media directory');
    }
  }
  try {
    settings.sourceLanguage = canonicalizeLanguage(
      validateLanguageCode(settings.sourceLanguage),
    );
    settings.targetLanguage = canonicalizeLanguage(
      validateLanguageCode(settings.targetLanguage),
    );
  } catch {
    fail('Invalid source or target language');
  }
  number(settings.scanCacheTtlMinutes, 'scanCacheTtlMinutes', 1, 10080, true);
  number(settings.concurrency, 'concurrency', 1, 16, true);
  list(settings.pathContainsExclusions, 'pathContainsExclusions', 200);
  if (settings.fileTooLargeBytes !== undefined)
    number(
      settings.fileTooLargeBytes,
      'fileTooLargeBytes',
      1,
      Number.MAX_SAFE_INTEGER,
      true,
    );
  for (const name of [
    'translationVerificationEnabled',
    'autoScanEnabled',
    'autoTranslateNewItems',
    'telegramEnabled',
  ] as const)
    if (typeof settings[name] !== 'boolean') fail(`${name} must be boolean`);
  if (
    !Array.isArray(settings.rules) ||
    settings.rules.length > 32 ||
    settings.rules.some(
      (rule) =>
        !rule ||
        typeof rule.id !== 'string' ||
        ![
          'already-has-target-subtitle',
          'already-has-external-subtitle',
          'no-source-track',
          'image-based-subtitle',
          'file-too-large',
          'path-contains',
        ].includes(rule.id) ||
        typeof rule.enabled !== 'boolean',
    ) ||
    new Set(settings.rules.map((rule) => rule.id)).size !==
      settings.rules.length
  )
    fail('Invalid rules');
  list(settings.telegramEvents, 'telegramEvents', 16, 64);
  if (
    settings.telegramEvents.some(
      (event) =>
        ![
          'job.completed',
          'job.failed',
          'scan.completed',
          'quota.warning',
          'quota.reached',
        ].includes(event),
    )
  )
    fail('Unknown Telegram event');
  for (const name of ['dailyTokenLimitFree', 'dailyTokenLimitPaid'] as const)
    if (settings[name] !== undefined)
      number(settings[name], name, 0, 1e12, true);
  if (settings.monthlyBudgetUsd !== undefined)
    number(settings.monthlyBudgetUsd, 'monthlyBudgetUsd', 0, 1e6);
  for (const name of [
    'deepSeekInputCacheHitUsdPerMillion',
    'deepSeekInputCacheMissUsdPerMillion',
    'deepSeekOutputUsdPerMillion',
  ] as const)
    if (settings[name] !== undefined) number(settings[name], name, 0, 1000);
  for (const name of ['openRouterModel', 'deepSeekModel'] as const)
    if (
      typeof settings[name] !== 'string' ||
      !settings[name].trim() ||
      settings[name].length > 200 ||
      /[\r\n\0]/.test(settings[name])
    )
      fail(`Invalid ${name}`);
  for (const name of SECRET_FIELDS)
    if (
      settings[name] !== undefined &&
      (typeof settings[name] !== 'string' ||
        settings[name].length > 4096 ||
        /[\r\n\0]/.test(settings[name]) ||
        isMaskedSecret(settings[name]))
    )
      fail(`Invalid ${name}`);
  for (const name of ['jellyfinUrl', 'pricingSource'] as const)
    if (settings[name]) {
      let url: URL;
      try {
        url = new URL(settings[name]);
      } catch {
        return fail(`Invalid ${name}`);
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        (name === 'jellyfinUrl' && url.search)
      )
        fail(`Invalid ${name}`);
    }
  if (
    settings.telegramChatId &&
    !/^-?\d{1,30}$|^@[a-zA-Z0-9_]{3,64}$/.test(settings.telegramChatId)
  )
    fail('Invalid Telegram chat ID');
  if (
    settings.pricingUpdatedAt &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(settings.pricingUpdatedAt) ||
      !Number.isFinite(Date.parse(settings.pricingUpdatedAt)))
  )
    fail('Invalid pricing date');
  if (
    typeof settings.autoScanCronExpression !== 'string' ||
    settings.autoScanCronExpression.length > 128
  )
    fail('Cron expression must be a string of at most 128 characters');
  if (settings.autoScanEnabled) {
    if (
      ![5, 6].includes(
        settings.autoScanCronExpression.trim().split(/\s+/).length,
      )
    )
      fail('Cron expression must have five or six fields');
    try {
      const cron = new CronTime(settings.autoScanCronExpression);
      let previous = cron
        .getNextDateFrom(new Date('2024-01-01T00:00:00Z'))
        .toJSDate();
      for (let index = 0; index < 60; index++) {
        const next = cron.getNextDateFrom(previous).toJSDate();
        if (next.getTime() - previous.getTime() < 5 * 60_000)
          fail('Automatic scans must be at least 5 minutes apart');
        previous = next;
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      fail('Invalid automatic scan cron expression');
    }
  }
  return settings;
}
