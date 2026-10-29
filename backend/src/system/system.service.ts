import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { assertWithinMediaRoots } from '../common/path-safety';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { SettingsService } from '../settings/settings.service';
import type {
  PermissionCheck,
  PreflightReport,
  RootCheck,
} from './system.types';

export interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  path: string;
  available?: boolean;
  readable?: boolean;
  writable?: boolean;
  error?: string;
}

/** Report stable categories, never raw errors (Redis URLs can contain credentials). */
function filesystemError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return 'Directory is unavailable';
  if (code === 'EACCES' || code === 'EPERM')
    return 'Directory permission denied';
  return 'Directory is inaccessible';
}

async function permissions(directory: string): Promise<PermissionCheck> {
  const result: PermissionCheck = {
    path: directory,
    available: false,
    readable: false,
    writable: false,
  };
  try {
    if (!(await fs.stat(directory)).isDirectory()) {
      result.error = 'Path is not a directory';
      return result;
    }
    result.available = true;
    const checks = await Promise.allSettled([
      fs.access(directory, constants.R_OK | constants.X_OK),
      fs.access(directory, constants.W_OK | constants.X_OK),
    ]);
    result.readable = checks[0].status === 'fulfilled';
    result.writable = checks[1].status === 'fulfilled';
    if (!result.readable || !result.writable)
      result.error = 'Directory permissions are insufficient';
  } catch (error) {
    result.error = filesystemError(error);
  }
  return result;
}

@Injectable()
export class SystemService {
  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly database: DataSource,
    @InjectQueue('translation') private readonly queue: Queue,
  ) {}

  async preflight(): Promise<PreflightReport> {
    const config = this.configService.getOrThrow<SubsyncEnvConfig>('subsync');
    const [settingsResult, dataResult, databaseResult, redisResult, keyResult] =
      await Promise.allSettled([
        this.settingsService.getSettings(),
        permissions(config.dataDir),
        this.checkDatabase(),
        this.checkRedis(),
        this.checkKey(config.dataDir),
      ]);
    const settings =
      settingsResult.status === 'fulfilled' ? settingsResult.value : null;
    const selected = settings?.mediaDirs ?? [];
    const paths = [...new Set([...config.mediaDirs, ...selected])];
    const rootResults = await Promise.allSettled(
      paths.map(async (directory): Promise<RootCheck> => {
        let allowed = config.mediaDirs.includes(directory);
        if (!allowed) {
          try {
            await assertWithinMediaRoots(directory, config.mediaDirs, {
              allowMissing: true,
            });
            allowed = true;
          } catch {
            /* Explicitly reported as outside the environment perimeter. */
          }
        }
        return {
          ...(await permissions(directory)),
          allowed,
          selected: selected.includes(directory),
        };
      }),
    );
    const roots = rootResults.map(
      (result, index): RootCheck =>
        result.status === 'fulfilled'
          ? result.value
          : {
              path: paths[index],
              available: false,
              readable: false,
              writable: false,
              allowed: config.mediaDirs.includes(paths[index]),
              selected: selected.includes(paths[index]),
              error: 'Root diagnostic failed',
            },
    );
    const provider = settings?.defaultProvider ?? 'openrouter';
    const keys = {
      openrouter: Boolean(settings?.openRouterApiKey),
      deepseek: Boolean(settings?.deepSeekApiKey),
      'opencode-go': Boolean(settings?.opencodeGoApiKey),
    };
    const report: PreflightReport = {
      status: 'ok',
      app: {
        status: 'ok',
        version: process.env.npm_package_version ?? '0.0.1',
      },
      data:
        dataResult.status === 'fulfilled'
          ? dataResult.value
          : {
              path: config.dataDir,
              available: false,
              readable: false,
              writable: false,
              error: 'Data diagnostic failed',
            },
      database:
        databaseResult.status === 'fulfilled'
          ? databaseResult.value
          : {
              status: 'error',
              accessible: false,
              migrationsPending: null,
              error: 'Database diagnostic failed',
            },
      redis:
        redisResult.status === 'fulfilled'
          ? redisResult.value
          : {
              status: 'error',
              ready: false,
              error: 'Redis is unavailable',
            },
      secretKey:
        keyResult.status === 'fulfilled'
          ? keyResult.value
          : {
              status: 'error',
              available: false,
              source: process.env.SUBSARR_SECRET_KEY ? 'environment' : 'file',
              error: 'Encryption key diagnostic failed',
            },
      providers: {
        status: !settings ? 'error' : keys[provider] ? 'ok' : 'warning',
        defaultProvider: settings ? provider : null,
        defaultModel: !settings
          ? null
          : provider === 'deepseek'
            ? settings.deepSeekModel
            : provider === 'opencode-go'
              ? (settings.opencodeGoModel ?? 'glm-5.2')
              : settings.openRouterModel,
        keys,
        ...(!settings ? { error: 'Settings are unavailable' } : {}),
      },
      roots,
      warnings: [],
    };
    if (!report.data.readable || !report.data.writable)
      report.warnings.push('Data directory requires read and write access');
    if (report.database.migrationsPending)
      report.warnings.push(
        'Database migrations are pending; restart after backing up data',
      );
    if (!report.secretKey.available)
      report.warnings.push(
        'Encryption key is unavailable; restore it before replacing saved credentials',
      );
    if (report.providers.status === 'warning')
      report.warnings.push('The default provider has no available credential');
    if (!settings)
      report.warnings.push('Saved settings could not be inspected');
    if (roots.some((root) => !root.available || !root.readable))
      report.warnings.push('Some media roots are unavailable or unreadable');
    if (roots.some((root) => root.selected && !root.allowed))
      report.warnings.push(
        'A saved media selection is outside the environment roots; repair the selection in Settings',
      );
    if (roots.some((root) => root.selected && !root.writable))
      report.warnings.push('Some selected media roots are not writable');
    if (
      report.database.status === 'error' ||
      report.redis.status === 'error' ||
      report.providers.status === 'error'
    )
      report.status = 'error';
    else if (report.warnings.length) report.status = 'warning';
    return report;
  }

  private async checkDatabase(): Promise<PreflightReport['database']> {
    let accessible = false;
    try {
      await this.database.query('SELECT 1');
      accessible = true;
      return {
        status: 'ok',
        accessible,
        migrationsPending: await this.database.showMigrations(),
      };
    } catch {
      return {
        status: 'error',
        accessible,
        migrationsPending: null,
        error: 'Database access or migration inspection failed',
      };
    }
  }

  private async checkRedis(): Promise<PreflightReport['redis']> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.queue.client.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 1500);
        }),
      ]);
      return response === 'PONG'
        ? { status: 'ok', ready: true }
        : {
            status: 'error',
            ready: false,
            error: 'Redis readiness check failed',
          };
    } catch {
      return { status: 'error', ready: false, error: 'Redis is unavailable' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async checkKey(
    dataDir: string,
  ): Promise<PreflightReport['secretKey']> {
    if (process.env.SUBSARR_SECRET_KEY)
      return { status: 'ok', available: true, source: 'environment' };
    try {
      const filename = path.join(dataDir, 'subsarr-secret.key');
      const stat = await fs.lstat(filename);
      await fs.access(filename, constants.R_OK);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32)
        throw new Error('invalid key');
      return { status: 'ok', available: true, source: 'file' };
    } catch {
      return {
        status: 'warning',
        available: false,
        source: 'file',
        error: 'Encryption key file is missing, invalid or unreadable',
      };
    }
  }

  async listDirectory(dirPath?: string): Promise<FileSystemEntry[]> {
    const roots =
      this.configService.getOrThrow<SubsyncEnvConfig>('subsync').mediaDirs;
    if (!dirPath) {
      const results = await Promise.allSettled(
        roots.map(async (root): Promise<FileSystemEntry> => {
          const check = await permissions(root);
          return {
            name: root,
            isDirectory: true,
            ...check,
            path: root.replace(/\\/g, '/'),
          };
        }),
      );
      return results.map((result, index) =>
        result.status === 'fulfilled'
          ? result.value
          : {
              name: roots[index],
              path: roots[index].replace(/\\/g, '/'),
              isDirectory: true,
              available: false,
              readable: false,
              writable: false,
              error: 'Root diagnostic failed',
            },
      );
    }
    try {
      const safePath = await assertWithinMediaRoots(dirPath, roots);
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      return entries
        .filter((entry) => !entry.isSymbolicLink())
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(safePath, entry.name).replace(/\\/g, '/'),
        }))
        .sort(
          (a, b) =>
            Number(b.isDirectory) - Number(a.isDirectory) ||
            a.name.localeCompare(b.name),
        );
    } catch {
      throw new BadRequestException(
        'Cannot browse directory: path is outside media roots or unavailable',
      );
    }
  }
}
