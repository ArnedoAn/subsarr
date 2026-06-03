jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));

import { TranslationVerificationService } from './translation-verification.service';

describe('TranslationVerificationService', () => {
  let service: TranslationVerificationService;

  beforeEach(() => {
    service = new TranslationVerificationService();
  });

  it('flags an SRT cue when a translated multiline cue drops an internal line', () => {
    const result = service.verifyTranslation(
      ['Line one\nLine two'],
      ['Linea uno'],
      'eng',
      'spa',
      { subtitleFormat: 'srt', semanticChecksEnabled: false },
    );

    expect(result.failedLines).toEqual([
      expect.objectContaining({
        index: 0,
        reason: 'missing_segments',
      }),
    ]);
  });

  it('flags an ASS dialogue when translated text drops the ASS line break marker', () => {
    const result = service.verifyTranslation(
      ['Line one\\NLine two'],
      ['Linea uno'],
      'eng',
      'spa',
      { subtitleFormat: 'ass', semanticChecksEnabled: false },
    );

    expect(result.failedLines).toEqual([
      expect.objectContaining({
        index: 0,
        reason: 'structure_changed',
      }),
    ]);
  });

  it('flags an ASS dialogue when translated text drops override tags', () => {
    const result = service.verifyTranslation(
      ['{\\i1}Hello{\\i0}'],
      ['Hola'],
      'eng',
      'spa',
      { subtitleFormat: 'ass', semanticChecksEnabled: false },
    );

    expect(result.failedLines).toEqual([
      expect.objectContaining({
        index: 0,
        reason: 'structure_changed',
      }),
    ]);
  });
});
