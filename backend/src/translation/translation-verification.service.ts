import { Injectable, Logger } from '@nestjs/common';
import { franc } from 'franc-min';

export interface FailedLine {
  index: number;
  sourceText: string;
  translatedText: string;
  reason:
    | 'identical_to_source'
    | 'wrong_language'
    | 'encoding_issues'
    | 'empty_translation';
  detectedLanguage?: string;
  confidence: number;
}

export interface VerificationResult {
  totalLines: number;
  passedLines: number;
  failedLines: FailedLine[];
  successRate: number;
}

const LANG_CODE_MAP: Record<string, string[]> = {
  spa: ['spa'],
  es: ['spa'],
  spanish: ['spa'],
  eng: ['eng'],
  en: ['eng'],
  english: ['eng'],
  por: ['por'],
  pt: ['por'],
  fra: ['fra'],
  fre: ['fra'],
  fr: ['fra'],
  deu: ['deu'],
  ger: ['deu'],
  de: ['deu'],
  ita: ['ita'],
  it: ['ita'],
  jpn: ['jpn'],
  ja: ['jpn'],
  zho: ['zho', 'cmn'],
  chi: ['zho', 'cmn'],
  zh: ['zho', 'cmn'],
  kor: ['kor'],
  ko: ['kor'],
  rus: ['rus'],
  ru: ['rus'],
  ara: ['ara'],
  ar: ['ara'],
  nld: ['nld'],
  nl: ['nld'],
  pol: ['pol'],
  pl: ['pol'],
  tur: ['tur'],
  tr: ['tur'],
  hin: ['hin'],
  hi: ['hin'],
  swe: ['swe'],
  sv: ['swe'],
  dan: ['dan'],
  da: ['dan'],
  nor: ['nob', 'nno'],
  no: ['nob', 'nno'],
  fin: ['fin'],
  fi: ['fin'],
  ces: ['ces'],
  cs: ['ces'],
  ron: ['ron'],
  ro: ['ron'],
  hun: ['hun'],
  hu: ['hun'],
  ell: ['ell'],
  el: ['ell'],
  heb: ['heb'],
  he: ['heb'],
  tha: ['tha'],
  th: ['tha'],
  vie: ['vie'],
  vi: ['vie'],
  ind: ['ind'],
  id: ['ind'],
  msa: ['zlm', 'msa'],
  ms: ['zlm', 'msa'],
  ukr: ['ukr'],
  uk: ['ukr'],
  bul: ['bul'],
  bg: ['bul'],
  hrv: ['hrv'],
  hr: ['hrv'],
  cat: ['cat'],
  ca: ['cat'],
};

const ENCODING_ISSUES_RE = /[\uFFFD\u0000]/;
const NON_TRANSLATABLE_RE = /^[\d\s\W]+$/;

@Injectable()
export class TranslationVerificationService {
  private readonly logger = new Logger(TranslationVerificationService.name);

  verifyTranslation(
    sourceLines: string[],
    translatedLines: string[],
    sourceLanguage: string,
    targetLanguage: string,
  ): VerificationResult {
    const failedLines: FailedLine[] = [];
    const targetCodes = this.resolveLanguageCodes(targetLanguage);

    for (let i = 0; i < sourceLines.length; i++) {
      const source = sourceLines[i];
      const translated = translatedLines[i];

      if (!translated || translated.trim().length === 0) {
        failedLines.push({
          index: i,
          sourceText: source,
          translatedText: translated ?? '',
          reason: 'empty_translation',
          confidence: 1,
        });
        continue;
      }

      if (ENCODING_ISSUES_RE.test(translated)) {
        failedLines.push({
          index: i,
          sourceText: source,
          translatedText: translated,
          reason: 'encoding_issues',
          confidence: 1,
        });
        continue;
      }

      if (source.trim().length < 5 || NON_TRANSLATABLE_RE.test(source.trim())) {
        continue;
      }

      const normalizedSource = source.trim().toLowerCase();
      const normalizedTranslated = translated.trim().toLowerCase();
      if (normalizedSource === normalizedTranslated) {
        failedLines.push({
          index: i,
          sourceText: source,
          translatedText: translated,
          reason: 'identical_to_source',
          confidence: 1,
        });
        continue;
      }

      if (translated.trim().length >= 15 && targetCodes.length > 0) {
        const detected = franc(translated.trim());
        if (detected !== 'und' && !targetCodes.includes(detected)) {
          const sourceCodes = this.resolveLanguageCodes(sourceLanguage);
          if (sourceCodes.includes(detected)) {
            failedLines.push({
              index: i,
              sourceText: source,
              translatedText: translated,
              reason: 'wrong_language',
              detectedLanguage: detected,
              confidence: 0.7,
            });
          }
        }
      }
    }

    const passedLines = sourceLines.length - failedLines.length;
    return {
      totalLines: sourceLines.length,
      passedLines,
      failedLines,
      successRate:
        sourceLines.length > 0
          ? Math.round((passedLines / sourceLines.length) * 10000) / 100
          : 100,
    };
  }

  logFailedLines(
    failedLines: FailedLine[],
    logFn: (message: string) => void,
  ): void {
    if (failedLines.length === 0) return;

    logFn(`Found ${failedLines.length} line(s) with translation issues`);

    const toLog = failedLines.slice(0, 20);
    for (const line of toLog) {
      const src =
        line.sourceText.length > 80
          ? line.sourceText.substring(0, 80) + '...'
          : line.sourceText;
      const tgt =
        line.translatedText.length > 80
          ? line.translatedText.substring(0, 80) + '...'
          : line.translatedText;
      logFn(
        `  Line ${line.index + 1}: [${line.reason}]${line.detectedLanguage ? ` (detected: ${line.detectedLanguage})` : ''} src="${src}" tgt="${tgt}"`,
      );
    }

    if (failedLines.length > 20) {
      logFn(`  ... and ${failedLines.length - 20} more`);
    }
  }

  private resolveLanguageCodes(language: string): string[] {
    const key = language.toLowerCase();
    return LANG_CODE_MAP[key] ?? [key];
  }
}
