import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LegacyImportService } from './legacy-import.service';
import { SettingEntity } from './entities/setting.entity';
import { SecretStore } from '../settings/secret-store';

const secrets = {
  openRouterApiKey: 'router-raw-secret',
  deepSeekApiKey: 'deepseek-raw-secret',
  telegramBotToken: 'telegram-raw-secret',
  jellyfinApiKey: 'jellyfin-raw-secret',
  tmdbApiKey: 'tmdb-raw-secret',
};

describe('LegacyImportService encrypted settings migration', () => {
  let directory: string;
  let filename: string;
  let save: jest.Mock<Promise<SettingEntity>, [SettingEntity]>;
  let settingsCount: number;
  let service: LegacyImportService;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-legacy-'));
    filename = path.join(directory, 'settings.json');
    save = jest.fn((entity: SettingEntity) => Promise.resolve(entity));
    settingsCount = 0;
    const database = {
      getRepository: (entity: unknown) =>
        entity === SettingEntity
          ? { count: () => Promise.resolve(settingsCount), save }
          : { count: () => Promise.resolve(1) },
    } as unknown as DataSource;
    const config = {
      get: () => ({
        dataDir: directory,
        settingsFilePath: filename,
        mediaDirs: ['/media'],
        sourceLanguage: 'eng',
        targetLanguage: 'spa',
        openRouterApiKey: '',
        deepSeekApiKey: '',
        scanCacheTtlMinutes: 30,
        concurrency: 2,
        pathExclusions: [],
      }),
    } as unknown as ConfigService;
    service = new LegacyImportService(database, config);
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('commits ciphertext and then keeps a restorable encrypted backup without raw keys', async () => {
    await fs.writeFile(
      filename,
      JSON.stringify({ ...secrets, pricingUpdatedAt: '2025-09-05' }),
    );
    await service.onModuleInit();
    const stored = save.mock.calls[0][0];
    const backupRaw = await fs.readFile(`${filename}.migrated.bak`, 'utf8');
    const backup = JSON.parse(backupRaw) as Record<string, string>;
    const store = new SecretStore(directory);
    for (const [field, value] of Object.entries(secrets)) {
      expect(backupRaw).not.toContain(value);
      expect(stored[field as keyof SettingEntity]).toMatch(/^enc:v1:/);
      expect(await store.decrypt(backup[field], field)).toBe(value);
    }
    expect(stored.deepSeekInputCacheHitUsdPerMillion).toBe(0.028);
    await expect(fs.access(filename)).rejects.toMatchObject({ code: 'ENOENT' });
    // Restoring the backup on the same installation authenticates and unwraps
    // ciphertext before encrypting database values; it never double encrypts.
    await fs.copyFile(`${filename}.migrated.bak`, filename);
    save.mockClear();
    await service.onModuleInit();
    const restored = save.mock.calls[0][0];
    expect(await store.decrypt(restored.tmdbApiKey!, 'tmdbApiKey')).toBe(
      secrets.tmdbApiKey,
    );
  });

  it('retains the complete original if the database commit fails', async () => {
    const original = JSON.stringify(secrets);
    await fs.writeFile(filename, original);
    save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.onModuleInit()).rejects.toThrow(
      'database unavailable',
    );
    expect(await fs.readFile(filename, 'utf8')).toBe(original);
    await expect(fs.access(`${filename}.migrated.bak`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('upgrades plaintext backups from older releases even when settings already exist', async () => {
    settingsCount = 1;
    await fs.writeFile(`${filename}.migrated.bak`, JSON.stringify(secrets));
    await service.onModuleInit();
    const backup = await fs.readFile(`${filename}.migrated.bak`, 'utf8');
    expect(backup).not.toContain(secrets.tmdbApiKey);
    expect(save).not.toHaveBeenCalled();
    const parsed = JSON.parse(backup) as Record<string, string>;
    expect(
      await new SecretStore(directory).decrypt(parsed.tmdbApiKey, 'tmdbApiKey'),
    ).toBe(secrets.tmdbApiKey);
  });

  it.each(['*/5 * * * *', '0 */5 * * * *', 'invalid-disabled-cron'])(
    'preserves recoverable legacy settings and all keys (%s)',
    async (cron) => {
      await fs.writeFile(
        filename,
        JSON.stringify({
          ...secrets,
          scanCacheTtlMinutes: 20160,
          concurrency: 20,
          autoScanCronExpression: cron,
          autoScanEnabled: cron !== 'invalid-disabled-cron',
        }),
      );
      await service.onModuleInit();
      const migrated = save.mock.calls[0][0];
      expect(migrated).toMatchObject({
        scanCacheTtlMinutes: 20160,
        concurrency: 20,
        autoScanCronExpression: cron,
      });
      const store = new SecretStore(directory);
      for (const [field, value] of Object.entries(secrets)) {
        expect(
          await store.decrypt(
            String(migrated[field as keyof SettingEntity]),
            field,
          ),
        ).toBe(value);
      }
      const backup = await fs.readFile(`${filename}.migrated.bak`, 'utf8');
      expect(backup).not.toContain(secrets.tmdbApiKey);
    },
  );

  it('fails closed on ciphertext with a missing original key without changing the backup', async () => {
    settingsCount = 1;
    const encrypted = await new SecretStore(directory, 'ab'.repeat(32)).encrypt(
      'secret',
      'tmdbApiKey',
    );
    const original = JSON.stringify({ tmdbApiKey: encrypted });
    await fs.writeFile(`${filename}.migrated.bak`, original);
    await expect(service.onModuleInit()).rejects.toThrow();
    expect(await fs.readFile(`${filename}.migrated.bak`, 'utf8')).toBe(
      original,
    );
  });
});
