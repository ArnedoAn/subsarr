import { registerAs } from '@nestjs/config';
import * as path from 'node:path';

export interface SubsyncEnvConfig {
  openRouterApiKey: string;
  deepSeekApiKey: string;
  mediaDirs: string[];
  scanCacheTtlMinutes: number;
  sourceLanguage: string;
  targetLanguage: string;
  concurrency: number;
  redisUrl: string;
  /** Persistent app data (job archive, settings parent dir, etc.). */
  dataDir: string;
  settingsFilePath: string;
  /** SQLite database path (default: dataDir/subsarr.db). */
  databasePath: string;
  pathExclusions: string[];
  fileTooLargeBytes?: number;
  probeConcurrency: number;
}

const parseNumber = (input: string | undefined, fallback: number): number => {
  if (!input) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseMediaDirs = (value: string | undefined): string[] => {
  if (!value) {
    return ['/media'];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const parseOptionalBytes = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

export const subsyncConfig = registerAs('subsync', (): SubsyncEnvConfig => {
  const settingsFilePath =
    process.env.SUBSYNC_SETTINGS_FILE_PATH ?? '/data/subsync.settings.json';
  const dataDir =
    process.env.SUBSYNC_DATA_DIR?.trim() || path.dirname(settingsFilePath);
  const databasePath =
    process.env.SUBSYNC_DATABASE_PATH?.trim() ||
    path.join(dataDir, 'subsarr.db');

  return {
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
    mediaDirs: parseMediaDirs(process.env.SUBSYNC_MEDIA_DIRS),
    scanCacheTtlMinutes: parseNumber(
      process.env.SUBSYNC_SCAN_CACHE_TTL_MINUTES,
      30,
    ),
    sourceLanguage: (
      process.env.SUBSYNC_SOURCE_LANGUAGE ?? 'eng'
    ).toLowerCase(),
    targetLanguage: (
      process.env.SUBSYNC_TARGET_LANGUAGE ?? 'spa'
    ).toLowerCase(),
    concurrency: parseNumber(process.env.SUBSYNC_CONCURRENCY, 2),
    redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
    dataDir,
    settingsFilePath,
    databasePath,
    pathExclusions: (process.env.SUBSYNC_PATH_EXCLUSIONS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    fileTooLargeBytes: parseOptionalBytes(
      process.env.SUBSYNC_FILE_TOO_LARGE_BYTES,
    ),
    probeConcurrency: Math.max(
      1,
      parseNumber(process.env.SUBSYNC_PROBE_CONCURRENCY, 10),
    ),
  };
});
