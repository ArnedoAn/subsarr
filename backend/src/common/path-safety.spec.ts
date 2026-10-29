import { promises as fs } from 'node:fs';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertWithinMediaRoots, validateLanguageCode } from './path-safety';

describe('media path safety', () => {
  let temporary: string;
  let root: string;
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-path-test-'));
    root = path.join(temporary, 'media');
    await fs.mkdir(root);
    await fs.mkdir(path.join(temporary, 'media-other'));
  });
  afterEach(async () => {
    await fs.rm(temporary, { recursive: true, force: true });
  });

  it('allows nested missing destinations but not prefix siblings', async () => {
    await expect(
      assertWithinMediaRoots(path.join(root, 'season', 'new.srt'), [root], {
        allowMissing: true,
      }),
    ).resolves.toBe(path.join(await fs.realpath(root), 'season', 'new.srt'));
    await expect(
      assertWithinMediaRoots(path.join(temporary, 'media-other'), [root]),
    ).rejects.toThrow('outside');
    await expect(
      assertWithinMediaRoots(path.join(root, '..', 'media-other'), [root]),
    ).rejects.toThrow('outside');
  });

  it('rejects existing and missing destinations through an escaping junction', async () => {
    const outside = path.join(temporary, 'media-other');
    await fs.writeFile(path.join(outside, 'existing.srt'), 'outside');
    await fs.symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      assertWithinMediaRoots(path.join(root, 'escape', 'existing.srt'), [root]),
    ).rejects.toThrow('outside');
    await expect(
      assertWithinMediaRoots(path.join(root, 'escape', 'missing.srt'), [root], {
        allowMissing: true,
      }),
    ).rejects.toThrow('outside');
  });

  it('matches healthy roots even when another mount is unavailable', async () => {
    await expect(
      assertWithinMediaRoots(root, [path.join(temporary, 'unmounted'), root]),
    ).resolves.toBe(await fs.realpath(root));
    await expect(
      assertWithinMediaRoots(path.join(temporary, 'media-other'), [
        path.join(temporary, 'unmounted'),
        root,
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertWithinMediaRoots(path.join(temporary, 'unmounted'), [root]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires explicitly allowed missing paths', async () => {
    await expect(
      assertWithinMediaRoots(path.join(root, 'missing'), [root]),
    ).rejects.toThrow();
    await expect(
      assertWithinMediaRoots('relative/file', [root], { allowMissing: true }),
    ).rejects.toThrow('absolute');
  });
});

describe('language filename safety', () => {
  it.each(['SPA', 'eng', 'pt-BR', 'zh-Hant'])(
    'canonicalizes %s without changing known codes',
    (input) => {
      expect(validateLanguageCode(input)).toBe(input.toLowerCase());
    },
  );
  it.each([
    '../eng',
    'en/../../x',
    'en\\x',
    'eng.srt',
    '',
    ' eng',
    'en\0',
    '-en',
  ])('rejects unsafe code %s', (input) => {
    expect(() => validateLanguageCode(input)).toThrow('Invalid language');
  });
});
