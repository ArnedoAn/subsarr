import { BadRequestException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { parseSettingsBundle } from './import-bundle';

function bundle(files: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  for (const [name, value] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(JSON.stringify(value)));
  }
  return zip.toBuffer();
}

const profile = {
  id: '47cd98f8-a057-4b43-a654-11d6759a9650',
  name: 'Films',
  pathPrefix: '/media/films',
  sourceLanguage: 'en',
  targetLanguage: 'de',
  provider: 'deepseek',
};

describe('parseSettingsBundle', () => {
  it('returns all validated importable sections and ignores token usage', () => {
    expect(
      parseSettingsBundle(
        bundle({
          'settings-runtime.json': { concurrency: 2 },
          'profiles.json': { profiles: [profile] },
          'glossary.json': { entries: [{ source: 'hello', target: 'hallo' }] },
          'token-usage-summary.json': { totalTokens: 999 },
        }),
      ),
    ).toEqual({
      settings: { concurrency: 2 },
      profiles: [profile],
      glossary: [{ source: 'hello', target: 'hallo' }],
    });
  });

  it('accepts empty collections without treating them as missing', () => {
    expect(
      parseSettingsBundle(
        bundle({
          'profiles.json': { profiles: [] },
          'glossary.json': { entries: [] },
        }),
      ),
    ).toEqual({ profiles: [], glossary: [] });
  });

  it.each([[[]], [null], ['settings'], [4]])(
    'rejects non-object settings: %p',
    (value) => {
      expect(() =>
        parseSettingsBundle(bundle({ 'settings-runtime.json': value })),
      ).toThrow(BadRequestException);
    },
  );

  it.each([
    { 'profiles.json': {} },
    { 'profiles.json': { profiles: [profile, profile] } },
    { 'profiles.json': { profiles: [{ ...profile, provider: 'other' }] } },
    { 'glossary.json': { entries: [{ source: 3, target: 'x' }] } },
    { 'glossary.json': { entries: [], extra: true } },
  ])('rejects invalid section schemas: %p', (files) => {
    expect(() => parseSettingsBundle(bundle(files))).toThrow(
      BadRequestException,
    );
  });

  it('rejects the complete bundle when a later section is invalid', () => {
    expect(() =>
      parseSettingsBundle(
        bundle({
          'profiles.json': { profiles: [profile] },
          'glossary.json': { entries: null },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed JSON and corrupt ZIP bytes', () => {
    const zip = new AdmZip();
    zip.addFile('profiles.json', Buffer.from('{'));
    expect(() => parseSettingsBundle(zip.toBuffer())).toThrow(
      BadRequestException,
    );
    expect(() => parseSettingsBundle(Buffer.from('not a zip'))).toThrow(
      BadRequestException,
    );
  });

  it.each([
    'folder/profiles.json',
    '..\\profiles.json',
    'C:profiles.json',
    'folder/',
  ])('rejects paths and directories: %s', (name) => {
    const zip = new AdmZip();
    zip.addFile(name, Buffer.from('{}'));
    expect(() => parseSettingsBundle(zip.toBuffer())).toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicate recognized entries rather than overwriting', () => {
    const bytes = bundle({
      'profiles.json': { profiles: [] },
      'xrofiles.json': { profiles: [] },
    });
    // Replace both local and central names without changing their lengths.
    let offset = bytes.indexOf('xrofiles.json');
    while (offset !== -1) {
      bytes.write('profiles.json', offset);
      offset = bytes.indexOf('xrofiles.json', offset + 1);
    }
    expect(() => parseSettingsBundle(bytes)).toThrow('Duplicate ZIP entry');
  });

  it('rejects more than eight entries and oversized uploads', () => {
    const files: Record<string, unknown> = { 'settings-runtime.json': {} };
    for (let i = 0; i < 8; i++) files[`extra-${i}.json`] = {};
    expect(() => parseSettingsBundle(bundle(files))).toThrow('more than 8');
    expect(() =>
      parseSettingsBundle(Buffer.alloc(2 * 1024 * 1024 + 1)),
    ).toThrow('at most 2 MiB');
    expect(() => parseSettingsBundle(Buffer.alloc(0))).toThrow(
      BadRequestException,
    );
  });

  it('checks every uncompressed header before attempting JSON decoding', () => {
    const zip = new AdmZip();
    zip.addFile('profiles.json', Buffer.from('not JSON'));
    zip.addFile('zz-oversized.txt', Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(() => parseSettingsBundle(zip.toBuffer())).toThrow(
      'ZIP entry exceeds limits',
    );
  });

  it('rejects the aggregate uncompressed limit including ignored entries', () => {
    const zip = new AdmZip();
    zip.addFile('settings-runtime.json', Buffer.from('{}'));
    for (let i = 0; i < 4; i++)
      zip.addFile(`ignored-${i}`, Buffer.alloc(2 * 1024 * 1024));
    expect(() => parseSettingsBundle(zip.toBuffer())).toThrow(
      'ZIP entry exceeds limits',
    );
  });

  it('rejects a forged zero-sized central header before unbounded inflation', () => {
    const bytes = bundle({
      'settings-runtime.json': { text: 'a'.repeat(100000) },
    });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(0, central + 24);
    expect(() => parseSettingsBundle(bytes)).toThrow('Empty JSON entry');
  });

  it('rejects a forged smaller header when inflation exceeds its declared limit', () => {
    const bytes = bundle({
      'settings-runtime.json': { text: 'a'.repeat(100000) },
    });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1, central + 24);
    expect(() => parseSettingsBundle(bytes)).toThrow(BadRequestException);
  });

  it('does not reimport token usage or unknown-only files', () => {
    expect(() =>
      parseSettingsBundle(bundle({ 'token-usage-summary.json': {} })),
    ).toThrow('No importable');
    expect(() => parseSettingsBundle(bundle({ 'readme.txt': {} }))).toThrow(
      'No importable',
    );
  });
});
