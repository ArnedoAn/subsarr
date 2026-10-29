import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DataSource } from 'typeorm';
import type { Queue } from 'bull';
import { SettingsService } from '../settings/settings.service';
import { SystemService } from './system.service';

describe('SystemService diagnostics and directory boundaries', () => {
  let root: string;
  let service: SystemService;
  let roots: string[];
  let selected: string[];
  const query = jest.fn();
  const showMigrations = jest.fn();
  const ping = jest.fn();
  const getSettings = jest.fn();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-browser-test-'));
    roots = [root];
    selected = [root];
    query.mockReset().mockResolvedValue([{ value: 1 }]);
    showMigrations.mockReset().mockResolvedValue(false);
    ping.mockReset().mockResolvedValue('PONG');
    getSettings.mockReset().mockImplementation(() =>
      Promise.resolve({
        mediaDirs: selected,
        defaultProvider: 'opencode-go',
        opencodeGoModel: 'glm-5.2',
        openRouterApiKey: 'never-expose-router',
        deepSeekApiKey: '',
        opencodeGoApiKey: 'never-expose-go',
      }),
    );
    await fs.writeFile(path.join(root, 'subsarr-secret.key'), Buffer.alloc(32));
    service = new SystemService(
      {
        getOrThrow: () => ({ mediaDirs: roots, dataDir: root }),
      } as unknown as ConfigService,
      { getSettings } as unknown as SettingsService,
      { query, showMigrations } as unknown as DataSource,
      { client: { ping } } as unknown as Queue,
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('shows configured roots and marks unavailable mounts independently', async () => {
    roots.unshift(path.join(root, 'unmounted'));
    const entries = await service.listDirectory();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ available: false, readable: false });
    expect(entries[1]).toMatchObject({
      path: root.replace(/\\/g, '/'),
      isDirectory: true,
      available: true,
    });
    expect(await service.listDirectory(root)).not.toHaveLength(0);
  });

  it('rejects outside and inaccessible paths with controlled client errors', async () => {
    await expect(
      service.listDirectory(path.dirname(root)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listDirectory(path.join(root, 'missing')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sorts actual directories first and skips symlinks', async () => {
    await fs.mkdir(path.join(root, 'z-directory'));
    await fs.writeFile(path.join(root, 'a-file'), 'fixture');
    await fs.symlink(
      path.dirname(root),
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const entries = await service.listDirectory(root);
    expect(entries.map((entry) => entry.name)).toEqual([
      'z-directory',
      'a-file',
      'subsarr-secret.key',
    ]);
  });

  it('reports default selection and credential booleans without leaking secrets', async () => {
    const report = await service.preflight();
    expect(report.status).toBe('ok');
    expect(report.providers).toEqual({
      status: 'ok',
      defaultProvider: 'opencode-go',
      defaultModel: 'glm-5.2',
      keys: { openrouter: true, deepseek: false, 'opencode-go': true },
    });
    expect(report.database).toEqual({
      status: 'ok',
      accessible: true,
      migrationsPending: false,
    });
    expect(JSON.stringify(report)).not.toContain('never-expose');
  });

  it('retains healthy roots and distinguishes saved selections outside the perimeter', async () => {
    roots.unshift(path.join(root, 'unmounted'));
    selected.push(path.dirname(root));
    const report = await service.preflight();
    expect(report.roots.find((entry) => entry.path === root)).toMatchObject({
      available: true,
      allowed: true,
      selected: true,
    });
    expect(report.roots[0]).toMatchObject({ available: false, allowed: true });
    expect(
      report.roots.find((entry) => entry.path === path.dirname(root)),
    ).toMatchObject({ allowed: false, selected: true });
    expect(report.status).toBe('warning');
  });

  it('inspects pending migrations without executing them', async () => {
    showMigrations.mockResolvedValue(true);
    const report = await service.preflight();
    expect(report.database.migrationsPending).toBe(true);
    expect(report.status).toBe('warning');
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports failed services independently and redacts connection errors', async () => {
    query.mockRejectedValue(new Error('private-database-location'));
    ping.mockRejectedValue(new Error('redis://user:private-password@host'));
    const report = await service.preflight();
    expect(report.status).toBe('error');
    expect(report.database.accessible).toBe(false);
    expect(report.redis.ready).toBe(false);
    expect(report.data.readable).toBe(true);
    expect(report.roots[0].available).toBe(true);
    expect(JSON.stringify(report)).not.toContain('private-');
  });
});
