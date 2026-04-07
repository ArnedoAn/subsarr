/**
 * Maps ISO 639-2B (bibliographic) aliases and 2-letter ISO 639-1 codes to
 * the canonical ISO 639-2T (terminology) 3-letter code used by ffprobe/Matroska.
 *
 * The goal is a single stable identifier for every language so that all
 * comparisons in rules, jobs, and scan are string-equal without extra logic.
 */
const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  // 2-letter ISO 639-1 → ISO 639-2T
  af: 'afr',
  sq: 'sqi',
  ar: 'ara',
  hy: 'hye',
  bg: 'bul',
  ca: 'cat',
  hr: 'hrv',
  cs: 'ces',
  da: 'dan',
  nl: 'nld',
  en: 'eng',
  et: 'est',
  fi: 'fin',
  fr: 'fra',
  de: 'deu',
  el: 'ell',
  he: 'heb',
  hi: 'hin',
  hu: 'hun',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  lv: 'lav',
  lt: 'lit',
  mk: 'mkd',
  ms: 'msa',
  no: 'nob',
  nb: 'nob',
  nn: 'nno',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sk: 'slk',
  sl: 'slv',
  es: 'spa',
  sv: 'swe',
  th: 'tha',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'zho',

  // ISO 639-2B (bibliographic) → ISO 639-2T (terminology)
  fre: 'fra', // French
  ger: 'deu', // German
  chi: 'zho', // Chinese
  cze: 'ces', // Czech
  wel: 'cym', // Welsh
  arm: 'hye', // Armenian
  baq: 'eus', // Basque
  slo: 'slk', // Slovak
  ice: 'isl', // Icelandic
  mac: 'mkd', // Macedonian
  rum: 'ron', // Romanian
  alb: 'sqi', // Albanian
  bur: 'mya', // Burmese
  tib: 'bod', // Tibetan
  dut: 'nld', // Dutch
  gre: 'ell', // Modern Greek
  per: 'fas', // Persian
};

/**
 * Returns the canonical 3-letter language code for the given input.
 * Handles ISO 639-1 (2-letter), ISO 639-2B, and ISO 639-2T codes.
 * Unknown codes are returned as-is (trimmed, lowercase).
 */
export function canonicalizeLanguage(input: string): string {
  const normalized = input.trim().toLowerCase();
  return LANGUAGE_ALIAS_MAP[normalized] ?? normalized;
}
