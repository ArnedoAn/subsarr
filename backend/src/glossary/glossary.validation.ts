import { BadRequestException } from '@nestjs/common';
import type { GlossaryEntry } from './glossary.types';

export const MAX_GLOSSARY_ENTRIES = 500;

/** Validate the complete payload before allowing any persistence. */
export function validateGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_GLOSSARY_ENTRIES) {
    throw new BadRequestException(
      `entries must be an array of at most ${MAX_GLOSSARY_ENTRIES} items`,
    );
  }
  return value.map((item: unknown, index) => {
    const fail = (): never => {
      throw new BadRequestException(`Invalid glossary entry at index ${index}`);
    };
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some((key) => key !== 'source' && key !== 'target'))
      return fail();
    const text = (key: string): string => {
      const field = entry[key];
      if (
        typeof field !== 'string' ||
        field.length > 4096 ||
        field.includes('\0')
      )
        return fail();
      return field;
    };
    return { source: text('source'), target: text('target') };
  });
}
