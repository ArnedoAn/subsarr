import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseDocument,
  type DocumentExtension,
  type SubtitleDocument,
} from '../translation/subtitle-document';
import type { SubtitleQualityReport } from '../translation-workspace/workspace.types';
import {
  displaySubtitleText,
  evaluateSubtitleQuality,
} from '../translation-workspace/quality-report';

export interface EvaluationCase {
  id: string;
  category: string;
  format: DocumentExtension;
  source: string;
  reference: string;
  expectedTerms: string[];
  notes: string;
}
export interface EvaluationCorpus {
  schemaVersion: number;
  version: string;
  sourceLanguage: string;
  targetLanguage: string;
  authorship: string;
  limitations: string;
  rubric: Array<{ dimension: string; scale: string; anchors: string }>;
  cases: EvaluationCase[];
}
export interface EvaluationScore {
  caseId: string;
  category: string;
  notes: string;
  passed: boolean;
  structure: {
    passed: boolean;
    errors: Array<{ code: string; message: string }>;
  };
  quality: SubtitleQualityReport | null;
  terminology: Array<{ term: string; present: boolean }>;
  referenceProxy: {
    wordEditDistance: number | null;
    referenceWordCount: number;
    normalizedWordEditDistance: number | null;
    interpretation: string;
  };
}
export const CORPUS_DIRECTORY =
  process.env.SUBSYNC_EVALUATION_CORPUS_DIR ??
  resolve(__dirname, '../../benchmarks/subtitles/v1');
export function loadEvaluationCorpus(
  directory = CORPUS_DIRECTORY,
): EvaluationCorpus {
  return JSON.parse(
    readFileSync(resolve(directory, 'corpus.json'), 'utf8'),
  ) as EvaluationCorpus;
}
export function loadEvaluationCase(
  testCase: EvaluationCase,
  directory = CORPUS_DIRECTORY,
) {
  return {
    source: readFileSync(resolve(directory, testCase.source), 'utf8'),
    reference: readFileSync(resolve(directory, testCase.reference), 'utf8'),
  };
}
function words(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLocaleLowerCase('es')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
export function wordEditDistance(
  reference: string[],
  candidate: string[],
): number {
  let previous = Array.from(
    { length: candidate.length + 1 },
    (_, index) => index,
  );
  for (let i = 0; i < reference.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < candidate.length; j++) {
      current.push(
        Math.min(
          current[j] + 1,
          previous[j + 1] + 1,
          previous[j] + Number(reference[i] !== candidate[j]),
        ),
      );
    }
    previous = current;
  }
  return previous[candidate.length];
}
export function scoreEvaluation(
  testCase: EvaluationCase,
  source: string,
  reference: string,
  candidate: string,
): EvaluationScore {
  const sourceDocument = parseDocument(source, testCase.format);
  const referenceDocument = parseDocument(reference, testCase.format);
  const errors: Array<{ code: string; message: string }> = [];
  let candidateDocument: SubtitleDocument | undefined;
  try {
    candidateDocument = parseDocument(candidate, testCase.format);
  } catch (error) {
    errors.push({
      code: 'parse',
      message: error instanceof Error ? error.message : 'Invalid candidate',
    });
  }
  let quality: SubtitleQualityReport | null = null;
  if (candidateDocument) {
    if (
      sourceDocument.cueCount !== candidateDocument.cueCount ||
      sourceDocument.cues.length !== candidateDocument.cues.length
    )
      errors.push({
        code: 'cue-count',
        message: 'Candidate changed the number of cues',
      });
    if (
      JSON.stringify(sourceDocument.preservedCues) !==
      JSON.stringify(candidateDocument.preservedCues)
    )
      errors.push({
        code: 'preserved-cues',
        message: 'Candidate changed empty or zero-duration cues',
      });
    // Compare everything outside dialogue too: VTT identifiers/settings and ASS
    // styles are protected even when the parser exposes only numeric ordinals.
    const skeleton = (document: SubtitleDocument) => {
      let result = document.content;
      for (let index = document.cues.length - 1; index >= 0; index--) {
        const cue = document.cues[index];
        result =
          result.slice(0, cue.textStart) + '\u0001' + result.slice(cue.textEnd);
      }
      return result.replace(/\r\n|\r/g, '\n').replace(/\n+$/, '');
    };
    if (skeleton(sourceDocument) !== skeleton(candidateDocument))
      errors.push({
        code: 'document-structure',
        message:
          'Candidate changed cue identifiers, timestamps, settings or document metadata',
      });
    for (const [ordinal, cue] of sourceDocument.cues.entries()) {
      const target = candidateDocument.cues[ordinal];
      if (!target) continue;
      if (target.index !== cue.index)
        errors.push({
          code: 'cue-id',
          message: `Cue ${ordinal + 1} changed identifier`,
        });
      if (target.start !== cue.start || target.end !== cue.end)
        errors.push({
          code: 'timestamp',
          message: `Cue ${ordinal + 1} changed timestamps`,
        });
    }
    if (sourceDocument.cues.length === candidateDocument.cues.length)
      quality = evaluateSubtitleQuality(
        sourceDocument,
        candidateDocument.cues.map((cue) => cue.text),
      );
    if (quality?.errorCount)
      errors.push({
        code: 'markup-or-lines',
        message:
          'Candidate changed protected markup or internal line structure',
      });
  }
  const referenceText = referenceDocument.cues
    .map((cue) => displaySubtitleText(cue.text, testCase.format))
    .join('\n');
  const candidateText =
    candidateDocument?.cues
      .map((cue) => displaySubtitleText(cue.text, testCase.format))
      .join('\n') ?? '';
  const candidateWords = words(candidateText);
  const referenceWords = words(referenceText);
  const normalized = ` ${candidateWords.join(' ')} `;
  const terminology = testCase.expectedTerms.map((term) => ({
    term,
    present: normalized.includes(` ${words(term).join(' ')} `),
  }));
  const editDistance = candidateDocument
    ? wordEditDistance(referenceWords, candidateWords)
    : null;
  return {
    caseId: testCase.id,
    category: testCase.category,
    notes: testCase.notes,
    passed: errors.length === 0 && terminology.every((term) => term.present),
    structure: { passed: errors.length === 0, errors },
    quality,
    terminology,
    referenceProxy: {
      wordEditDistance: editDistance,
      referenceWordCount: referenceWords.length,
      normalizedWordEditDistance:
        editDistance === null
          ? null
          : editDistance / Math.max(1, referenceWords.length),
      interpretation:
        'Lexical difference only, not linguistic accuracy. Valid alternate translations can differ from the reference.',
    },
  };
}
