import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { TranslationProfile } from './profile.types';
import { validateProviderModel } from '../common/translation-provider';

export const MAX_PROFILES = 500;

/** Shared by the HTTP write path and bundle imports; never coerces input. */
export function validateProfiles(value: unknown): TranslationProfile[] {
  if (!Array.isArray(value) || value.length > MAX_PROFILES) {
    throw new BadRequestException(
      `profiles must be an array of at most ${MAX_PROFILES} items`,
    );
  }
  const ids = new Set<string>();
  return value.map((item: unknown, index) => {
    const fail = (): never => {
      throw new BadRequestException(`Invalid profile at index ${index}`);
    };
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const profile = item as Record<string, unknown>;
    const allowed = [
      'id',
      'name',
      'pathPrefix',
      'sourceLanguage',
      'targetLanguage',
      'provider',
      'model',
    ];
    if (Object.keys(profile).some((key) => !allowed.includes(key)))
      return fail();
    const text = (key: string, max: number): string => {
      const field = profile[key];
      if (
        typeof field !== 'string' ||
        !field.trim() ||
        field.length > max ||
        field.includes('\0')
      )
        return fail();
      return field;
    };
    const id = text('id', 64);
    if (!isUUID(id) || ids.has(id.toLowerCase())) return fail();
    ids.add(id.toLowerCase());
    const result: TranslationProfile = {
      id,
      name: text('name', 200),
      pathPrefix: text('pathPrefix', 4096),
      sourceLanguage: text('sourceLanguage', 64),
      targetLanguage: text('targetLanguage', 64),
    };
    if (profile.provider !== undefined) {
      if (
        profile.provider !== 'openrouter' &&
        profile.provider !== 'deepseek' &&
        profile.provider !== 'opencode-go'
      )
        return fail();
      result.provider = profile.provider;
    }
    if (profile.model !== undefined) {
      const model = text('model', 128);
      validateProviderModel(result.provider, model);
      result.model = model;
    }
    return result;
  });
}
