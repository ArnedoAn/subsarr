import { BadRequestException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import type { TranslationProfile } from '../profiles/profile.types';
import { validateProfiles } from '../profiles/profile.validation';
import type { GlossaryEntry } from '../glossary/glossary.types';
import { validateGlossary } from '../glossary/glossary.validation';

const MAX_COMPRESSED = 2 * 1024 * 1024;
const MAX_ENTRY = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED = 8 * 1024 * 1024;
const RECOGNIZED: Record<string, true | undefined> = {
  'settings-runtime.json': true,
  'profiles.json': true,
  'glossary.json': true,
  'token-usage-summary.json': true,
};

export interface SettingsBundle {
  settings?: Record<string, unknown>;
  profiles?: TranslationProfile[];
  glossary?: GlossaryEntry[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse and validate every imported section before the caller writes anything. */
export function parseSettingsBundle(buffer: Buffer): SettingsBundle {
  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    buffer.length > MAX_COMPRESSED
  ) {
    throw new BadRequestException(
      'ZIP file must be nonempty and at most 2 MiB',
    );
  }
  try {
    const entries = new AdmZip(buffer).getEntries();
    if (entries.length > 8)
      throw new BadRequestException('ZIP has more than 8 entries');
    const seen = new Set<string>();
    let total = 0;
    // Complete this pass before calling getData: its inflater allocates from size.
    for (const entry of entries) {
      const name = entry.entryName;
      if (
        entry.isDirectory ||
        /[\\/:\0]/.test(name) ||
        name === '.' ||
        name === '..' ||
        !name
      ) {
        throw new BadRequestException('ZIP must contain root-level files only');
      }
      if (Object.hasOwn(RECOGNIZED, name)) {
        if (seen.has(name))
          throw new BadRequestException(`Duplicate ZIP entry: ${name}`);
        seen.add(name);
      }
      const { size, compressedSize, method, flags } = entry.header;
      total += size;
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > MAX_ENTRY ||
        !Number.isSafeInteger(compressedSize) ||
        compressedSize < 0 ||
        compressedSize > buffer.length ||
        total > MAX_UNCOMPRESSED ||
        (flags & 1) !== 0 ||
        (method !== 0 && method !== 8) ||
        (method === 0 && size !== compressedSize)
      ) {
        throw new BadRequestException(
          'ZIP entry exceeds limits or uses unsupported encoding',
        );
      }
    }
    const result: SettingsBundle = {};
    for (const entry of entries) {
      const name = entry.entryName;
      if (
        !Object.hasOwn(RECOGNIZED, name) ||
        name === 'token-usage-summary.json'
      )
        continue;
      // AdmZip caps inflation at the positive declared size. Never inflate a
      // zero-size declaration: that disables its maxOutputLength protection.
      if (entry.header.size === 0)
        throw new BadRequestException(`Empty JSON entry: ${name}`);
      const data = entry.getData();
      if (data.length !== entry.header.size || data.length > MAX_ENTRY) {
        throw new BadRequestException(`Invalid ZIP entry size: ${name}`);
      }
      const parsed: unknown = JSON.parse(data.toString('utf8'));
      if (!object(parsed))
        throw new BadRequestException(`Expected JSON object in ${name}`);
      if (name === 'settings-runtime.json') result.settings = parsed;
      if (name === 'profiles.json') {
        if (Object.keys(parsed).some((key) => key !== 'profiles'))
          throw new BadRequestException('Invalid profiles.json schema');
        result.profiles = validateProfiles(parsed.profiles);
      }
      if (name === 'glossary.json') {
        if (Object.keys(parsed).some((key) => key !== 'entries'))
          throw new BadRequestException('Invalid glossary.json schema');
        result.glossary = validateGlossary(parsed.entries);
      }
    }
    if (!Object.keys(result).length)
      throw new BadRequestException(
        'No importable settings, profiles or glossary found in ZIP',
      );
    return result;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Invalid settings ZIP bundle');
  }
}
