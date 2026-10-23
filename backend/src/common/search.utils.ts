import { canonicalizeLanguage } from './language.utils';

/** Keep every release/year token; only normalize accents and separators. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface ParsedSearch {
  terms: string[];
  languages: string[];
  missing: string[];
  type?: 'movie' | 'episode' | 'unknown';
}

export function parseSearch(query: string): ParsedSearch {
  const result: ParsedSearch = { terms: [], languages: [], missing: [] };
  for (const match of query.matchAll(
    /(?:([^\s:"]+):)?(?:"([^"]+)"|([^\s"]+))/g,
  )) {
    const field = match[1]?.toLowerCase();
    const value = match[2] ?? match[3];
    if (field === 'lang' || field === 'missing') {
      result[field === 'lang' ? 'languages' : 'missing'].push(
        canonicalizeLanguage(value),
      );
    } else if (
      field === 'type' &&
      ['movie', 'episode', 'unknown'].includes(value)
    ) {
      result.type = value as ParsedSearch['type'];
    } else {
      const normalized = normalizeSearch(field ? `${field}:${value}` : value);
      if (normalized) result.terms.push(normalized);
    }
  }
  return result;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
