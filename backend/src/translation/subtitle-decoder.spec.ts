jest.mock('jschardet', () => ({ detect: jest.fn() }));
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
import { decodeSubtitle } from './subtitle-document';

describe('subtitle decoding boundary', () => {
  const detect = jest.mocked(jschardet.detect);
  beforeEach(() => {
    detect.mockReset();
  });
  it('uses strict UTF-8 before legacy detection', () => {
    const source = 'Español — 日本語';
    expect(decodeSubtitle(Buffer.from(source))).toBe(source);
    expect(detect).not.toHaveBeenCalled();
  });
  it.each(['utf16-le', 'utf16-be'])(
    'honors %s BOM before detection and retains the BOM',
    (encoding) => {
      const source =
        '\ufeff1\r\n00:00:01,000 --> 00:00:02,000\r\nEspañol — 日本語\r\n';
      expect(decodeSubtitle(iconv.encode(source, encoding))).toBe(source);
      expect(detect).not.toHaveBeenCalled();
    },
  );
  it('decodes confident Windows-1252 punctuation and accents losslessly', () => {
    detect.mockReturnValue({ encoding: 'windows-1252', confidence: 0.99 });
    const source = '“Olá, José!” — Café: 10 €.';
    expect(decodeSubtitle(iconv.encode(source, 'windows-1252'))).toBe(source);
  });
  it.each([
    { encoding: 'windows-1252', confidence: 0.5 },
    { encoding: 'unsupported-charset', confidence: 1 },
    { encoding: 'UTF-8', confidence: 1 },
    { encoding: undefined, confidence: 0 },
  ])(
    'rejects uncertain or unsupported legacy encoding with actionable guidance: %s',
    (detection) => {
      detect.mockReturnValue(detection);
      expect(() => decodeSubtitle(Buffer.from([0x93, 0xe9, 0x94]))).toThrow(
        'Re-save the file as UTF-8',
      );
    },
  );
  it('rejects a lossy decoder result despite confident detection', () => {
    detect.mockReturnValue({ encoding: 'utf16-le', confidence: 1 });
    expect(() => decodeSubtitle(Buffer.from([0xff]))).toThrow(
      'ambiguous or unsupported',
    );
  });
  it('does not reinterpret invalid explicit UTF-8 or UTF-16 BOM input as legacy text', () => {
    expect(() =>
      decodeSubtitle(Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28])),
    ).toThrow('Invalid UTF-8');
    expect(() => decodeSubtitle(Buffer.from([0xff, 0xfe, 0x61]))).toThrow(
      'Invalid UTF-16',
    );
    expect(detect).not.toHaveBeenCalled();
  });
});
