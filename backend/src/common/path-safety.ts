import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

async function resolveExisting(
  candidate: string,
  allowMissing: boolean,
): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error;
    // A dangling symlink must never be treated as a missing ordinary component.
    try {
      await fs.lstat(candidate);
      throw new BadRequestException('Cannot resolve symbolic link');
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT')
        throw statError;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(
      await resolveExisting(parent, true),
      path.basename(candidate),
    );
  }
}

/** Resolve symlinks before comparing complete relative path segments, including missing destinations. */
export async function assertWithinMediaRoots(
  candidate: string,
  roots: string[],
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  if (
    typeof candidate !== 'string' ||
    !candidate ||
    candidate.includes('\0') ||
    !path.isAbsolute(candidate)
  ) {
    throw new BadRequestException('An absolute local media path is required');
  }
  const resolved = await resolveExisting(
    path.resolve(candidate),
    options.allowMissing === true,
  );
  for (const root of roots) {
    if (!path.isAbsolute(root)) continue;
    const realRoot = await fs.realpath(root);
    const relative = path.relative(realRoot, resolved);
    // Node's win32 relative comparison handles drive letters and case correctly.
    if (
      relative === '' ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
    ) {
      return resolved;
    }
  }
  throw new ForbiddenException('Path is outside the configured media roots');
}

export function validateLanguageCode(input: string): string {
  if (
    typeof input !== 'string' ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(input)
  ) {
    throw new BadRequestException('Invalid language code');
  }
  return input.toLowerCase();
}
