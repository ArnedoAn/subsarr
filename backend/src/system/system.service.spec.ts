import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SystemService } from './system.service';

describe('SystemService directory boundaries', () => {
  let root: string;
  let service: SystemService;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-browser-test-'));
    service = new SystemService({
      getOrThrow: () => ({ mediaDirs: [root] }),
    } as unknown as ConfigService);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('shows configured roots instead of the host filesystem when no path is supplied', async () => {
    const entries = await service.listDirectory();
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe((await fs.realpath(root)).replace(/\\/g, '/'));
    expect(entries[0].isDirectory).toBe(true);
  });

  it('rejects outside and inaccessible paths instead of reporting an empty directory', async () => {
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
    ]);
  });
});
