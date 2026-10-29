import { registerAs } from '@nestjs/config';
import * as path from 'node:path';
import { validateLanguageCode } from '../common/path-safety';
import { validateProviderModel } from '../common/translation-provider';
import type { TranslationProvider } from '../contracts/providers';

export interface SubsyncEnvConfig {
  openRouterApiKey: string;
  deepSeekApiKey: string;
  opencodeGoApiKey: string;
  opencodeGoModel: string;
  defaultProvider: TranslationProvider;
  mediaDirs: string[];
  scanCacheTtlMinutes: number;
  sourceLanguage: string;
  targetLanguage: string;
  concurrency: number;
  redisUrl: string;
  dataDir: string;
  settingsFilePath: string;
  databasePath: string;
  pathExclusions: string[];
  fileTooLargeBytes?: number;
  probeConcurrency: number;
  watchEnabled: boolean;
}

export const subsyncConfig = registerAs('subsync', (): SubsyncEnvConfig => {
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const number = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(number) ||
      number < min ||
      number > max
    )
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return number;
  };
  const settingsFilePath =
    process.env.SUBSYNC_SETTINGS_FILE_PATH?.trim() ||
    '/data/subsync.settings.json';
  const dataDir =
    process.env.SUBSYNC_DATA_DIR?.trim() || path.dirname(settingsFilePath);
  const databasePath =
    process.env.SUBSYNC_DATABASE_PATH?.trim() ||
    path.join(dataDir, 'subsarr.db');
  for (const [name, value] of Object.entries({
    settingsFilePath,
    dataDir,
    databasePath,
  })) {
    if (!path.isAbsolute(value) || value.includes('\0'))
      throw new Error(`${name} must be an absolute safe path`);
  }
  const mediaDirs = (process.env.SUBSYNC_MEDIA_DIRS ?? '/media')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !mediaDirs.length ||
    mediaDirs.length > 32 ||
    mediaDirs.some(
      (value) =>
        !path.isAbsolute(value) || value.length > 4096 || value.includes('\0'),
    )
  )
    throw new Error('SUBSYNC_MEDIA_DIRS must contain 1..32 absolute roots');
  const pathExclusions = (process.env.SUBSYNC_PATH_EXCLUSIONS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    pathExclusions.length > 200 ||
    pathExclusions.some((value) => value.length > 4096 || value.includes('\0'))
  )
    throw new Error('SUBSYNC_PATH_EXCLUSIONS is too large or invalid');
  const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  const redis = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(redis.protocol))
    throw new Error('REDIS_URL must use redis:// or rediss://');
  if (process.env.SUBSARR_SECRET_KEY) {
    const value = process.env.SUBSARR_SECRET_KEY.trim();
    const key = /^[a-f0-9]{64}$/i.test(value)
      ? Buffer.from(value, 'hex')
      : Buffer.from(value, 'base64');
    if (
      key.length !== 32 ||
      (!/^[a-f0-9]{64}$/i.test(value) && key.toString('base64') !== value)
    )
      throw new Error(
        'SUBSARR_SECRET_KEY must encode exactly 32 bytes as hex or base64',
      );
  }
  const defaultProvider = process.env.SUBSYNC_DEFAULT_PROVIDER ?? 'openrouter';
  if (
    defaultProvider !== 'openrouter' &&
    defaultProvider !== 'deepseek' &&
    defaultProvider !== 'opencode-go'
  )
    throw new Error(
      'SUBSYNC_DEFAULT_PROVIDER must be openrouter, deepseek or opencode-go',
    );
  const opencodeGoModel = process.env.OPENCODE_GO_MODEL ?? 'glm-5.2';
  validateProviderModel('opencode-go', opencodeGoModel);
  const opencodeGoApiKey = process.env.OPENCODE_GO_API_KEY ?? '';
  if (opencodeGoApiKey.length > 4096 || /[\r\n\0]/.test(opencodeGoApiKey))
    throw new Error('OPENCODE_GO_API_KEY is invalid or too large');
  const watchEnabled = process.env.SUBSYNC_WATCH_ENABLED ?? 'false';
  if (watchEnabled !== 'true' && watchEnabled !== 'false')
    throw new Error('SUBSYNC_WATCH_ENABLED must be true or false');
  return {
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
    opencodeGoApiKey,
    opencodeGoModel,
    defaultProvider,
    mediaDirs,
    scanCacheTtlMinutes: integer(
      'SUBSYNC_SCAN_CACHE_TTL_MINUTES',
      30,
      1,
      10080,
    ),
    sourceLanguage: validateLanguageCode(
      process.env.SUBSYNC_SOURCE_LANGUAGE ?? 'eng',
    ),
    targetLanguage: validateLanguageCode(
      process.env.SUBSYNC_TARGET_LANGUAGE ?? 'spa',
    ),
    concurrency: integer('SUBSYNC_CONCURRENCY', 2, 1, 16),
    redisUrl,
    dataDir,
    settingsFilePath,
    databasePath,
    pathExclusions,
    fileTooLargeBytes: process.env.SUBSYNC_FILE_TOO_LARGE_BYTES
      ? integer('SUBSYNC_FILE_TOO_LARGE_BYTES', 1, 1, Number.MAX_SAFE_INTEGER)
      : undefined,
    watchEnabled: watchEnabled === 'true',
    probeConcurrency: integer('SUBSYNC_PROBE_CONCURRENCY', 10, 1, 32),
  };
});
