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
    candidate.length > 4096 ||
    candidate.includes('\0') ||
    !path.isAbsolute(candidate)
  ) {
    throw new BadRequestException('An absolute local media path is required');
  }
  let resolved: string;
  try {
    resolved = await resolveExisting(
      path.resolve(candidate),
      options.allowMissing === true,
    );
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Media path is unavailable or inaccessible');
  }
  // A failed mount must not prevent access through another healthy root.
  const resolvedRoots = await Promise.allSettled(
    roots
      .filter((root) => path.isAbsolute(root))
      .map((root) => fs.realpath(root)),
  );
  for (const root of resolvedRoots) {
    if (root.status !== 'fulfilled') continue;
    const realRoot = root.value;
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
