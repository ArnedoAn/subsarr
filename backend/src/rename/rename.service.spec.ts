import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { RenameService } from './rename.service';

describe('RenameService', () => {
  let service: RenameService;
  let tempDir: string;

  beforeEach(async () => {
    service = new RenameService();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'subsarr-rename-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects dot-separated episode names and skips unchanged preview items', async () => {
    await writeFile(
      path.join(tempDir, 'The.Show.S01.E02.The.Return.1080p.WEB-DL-GRP.mkv'),
      '',
    );
    await writeFile(path.join(tempDir, 'Already Clean (2020).mkv'), '');

    const preview = await service.getPreview(tempDir);

    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      originalName: 'The.Show.S01.E02.The.Return.1080p.WEB-DL-GRP.mkv',
      mediaKind: 'episode',
    });
    expect(preview[0]?.variations[0]).toMatchObject({
      id: 'series-dash',
      status: 'safe',
      newPath: path.join(tempDir, 'The Show - S01E02 - The Return.mkv'),
    });
  });

  it('detects movie names with bracketed years and strips release tokens', async () => {
    await writeFile(
      path.join(tempDir, 'The.Matrix.[1999].2160p.BluRay.x265-GRP.mkv'),
      '',
    );

    const preview = await service.getPreview(tempDir);

    expect(preview[0]).toMatchObject({
      mediaKind: 'movie',
    });
    expect(preview[0]?.variations[0]).toMatchObject({
      id: 'movie-parens',
      status: 'safe',
      newPath: path.join(tempDir, 'The Matrix (1999).mkv'),
    });
  });

  it('marks preview variations that would overwrite an existing destination', async () => {
    await writeFile(path.join(tempDir, 'Show.S01E02.1080p.mkv'), '');
    await writeFile(path.join(tempDir, 'Show - S01E02.mkv'), '');

    const preview = await service.getPreview(tempDir);

    expect(preview).toHaveLength(1);
    expect(preview[0]?.variations[0]).toMatchObject({
      status: 'collision',
      reason: 'Destination already exists',
    });
  });

  it('rejects batches that contain duplicate target paths before renaming anything', async () => {
    const first = path.join(tempDir, 'A.mkv');
    const second = path.join(tempDir, 'B.mkv');
    const target = path.join(tempDir, 'Target.mkv');
    await writeFile(first, 'first');
    await writeFile(second, 'second');

    const result = await service.executeRename([
      { originalPath: first, newPath: target },
      { originalPath: second, newPath: target },
    ]);

    expect(result).toMatchObject({
      success: 0,
      failed: 2,
    });
    expect(result.errors).toEqual([
      {
        originalPath: first,
        error: 'Duplicate target path in rename batch',
        code: 'duplicate_target',
      },
      {
        originalPath: second,
        error: 'Duplicate target path in rename batch',
        code: 'duplicate_target',
      },
    ]);
    await expect(readFile(first, 'utf8')).resolves.toBe('first');
    await expect(readFile(second, 'utf8')).resolves.toBe('second');
  });

  it('rejects an existing destination before renaming anything', async () => {
    const source = path.join(tempDir, 'Source.mkv');
    const target = path.join(tempDir, 'Target.mkv');
    await writeFile(source, 'source');
    await writeFile(target, 'target');

    const result = await service.executeRename([
      { originalPath: source, newPath: target },
    ]);

    expect(result).toMatchObject({
      success: 0,
      failed: 1,
      errors: [
        {
          originalPath: source,
          error: 'Destination already exists',
          code: 'destination_exists',
        },
      ],
    });
    await expect(readFile(source, 'utf8')).resolves.toBe('source');
    await expect(readFile(target, 'utf8')).resolves.toBe('target');
  });

  it('supports Season and Episode naming from nested folders', async () => {
    const showDir = path.join(tempDir, 'Slow Horses', 'Season 2');
    await mkdir(showDir, { recursive: true });
    await writeFile(path.join(showDir, 'Episode 03 - Drinking Games.mkv'), '');

    const preview = await service.getPreview(tempDir);

    expect(preview[0]?.variations[0]).toMatchObject({
      newPath: path.join(showDir, 'Slow Horses - S02E03 - Drinking Games.mkv'),
    });
  });
});
