import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CORPUS_DIRECTORY,
  loadEvaluationCase,
  loadEvaluationCorpus,
  scoreEvaluation,
  wordEditDistance,
} from './evaluation-scoring';

const corpus = loadEvaluationCorpus();
function scoreCase(id: string, fixture?: string) {
  const testCase = corpus.cases.find((entry) => entry.id === id)!;
  const { source, reference } = loadEvaluationCase(testCase);
  const candidate = fixture
    ? readFileSync(resolve(CORPUS_DIRECTORY, 'regressions', fixture), 'utf8')
    : reference;
  return scoreEvaluation(testCase, source, reference, candidate);
}

describe('deterministic evaluation scoring', () => {
  it.each(corpus.cases.map((entry) => entry.id))(
    'accepts the curated %s reference without claiming linguistic accuracy',
    (id) => {
      const result = scoreCase(id);
      expect(result.passed).toBe(true);
      expect(result.referenceProxy.wordEditDistance).toBe(0);
      expect(result.referenceProxy.interpretation).toContain(
        'not linguistic accuracy',
      );
    },
  );

  it('rejects changed timestamps even if all text matches', () => {
    const result = scoreCase('humor', 'broken-timestamps/humor.srt');
    expect(result.passed).toBe(false);
    expect(
      result.structure.errors.some((issue) => issue.code === 'timestamp'),
    ).toBe(true);
    expect(result.referenceProxy.wordEditDistance).toBe(0);
  });

  it('rejects removed protected ASS markup', () => {
    const result = scoreCase('anime', 'broken-markup/anime.ass');
    expect(result.passed).toBe(false);
    expect(result.quality?.errorCount).toBeGreaterThan(0);
  });

  it('reports absent terminology separately from structure', () => {
    const result = scoreCase('humor', 'missing-terms/humor.srt');
    expect(result.structure.passed).toBe(true);
    expect(result.passed).toBe(false);
    expect(
      result.terminology
        .filter((term) => !term.present)
        .map((term) => term.term),
    ).toEqual(['robot', 'descafeinado']);
  });

  it('catches VTT identifiers not exposed as parser cue indices', () => {
    const result = scoreCase('idioms', 'broken-identifiers/idioms.vtt');
    expect(
      result.structure.errors.some(
        (issue) => issue.code === 'document-structure',
      ),
    ).toBe(true);
  });

  it('does not treat alternative wording as a linguistic failure', () => {
    const testCase = corpus.cases.find((entry) => entry.id === 'humor')!;
    const { source, reference } = loadEvaluationCase(testCase);
    const result = scoreEvaluation(
      testCase,
      source,
      reference,
      reference.replace('hizo una pausa para café', 'se tomó un café'),
    );
    expect(result.passed).toBe(true);
    expect(result.referenceProxy.wordEditDistance).toBeGreaterThan(0);
  });

  it('reports readability warnings without failing preserved structure', () => {
    const testCase = corpus.cases.find((entry) => entry.id === 'humor')!;
    const { source, reference } = loadEvaluationCase(testCase);
    const result = scoreEvaluation(
      testCase,
      source,
      reference,
      reference.replace(
        'El robot hizo una pausa para café.',
        `El robot ${'habla muchísimo '.repeat(10)}`,
      ),
    );
    expect(result.passed).toBe(true);
    expect(result.quality?.cues[0].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['cps', 'line-length']),
    );
  });

  it('rejects dropped cues, cue ids and malformed documents', () => {
    const testCase = corpus.cases.find((entry) => entry.id === 'humor')!;
    const { source, reference } = loadEvaluationCase(testCase);
    expect(
      scoreEvaluation(
        testCase,
        source,
        reference,
        reference.split('\n\n')[0],
      ).structure.errors.some((issue) => issue.code === 'cue-count'),
    ).toBe(true);
    expect(
      scoreEvaluation(
        testCase,
        source,
        reference,
        reference.replace(/^1\n/, '9\n'),
      ).structure.errors.some((issue) => issue.code === 'cue-id'),
    ).toBe(true);
    expect(
      scoreEvaluation(testCase, source, reference, 'not a subtitle').structure
        .errors[0].code,
    ).toBe('parse');
  });

  it('computes insertion, deletion and substitution distance', () => {
    expect(wordEditDistance(['a', 'b'], ['a', 'c', 'd'])).toBe(2);
    expect(wordEditDistance(['a'], [])).toBe(1);
    expect(wordEditDistance([], ['a'])).toBe(1);
  });
});
