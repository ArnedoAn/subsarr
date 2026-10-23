import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { GlossaryService } from './glossary.service';
import { MAX_GLOSSARY_ENTRIES, validateGlossary } from './glossary.validation';

const entry = { source: 'hello', target: 'hallo' };

describe('validateGlossary', () => {
  it('accepts bounded strings and the existing empty-string contract', () => {
    expect(validateGlossary([{ source: '', target: '' }])).toEqual([
      { source: '', target: '' },
    ]);
    const input = Array.from({ length: MAX_GLOSSARY_ENTRIES }, () => entry);
    expect(validateGlossary(input)).toEqual(input);
    expect(validateGlossary(input)[0]).not.toBe(entry);
    expect(
      validateGlossary([
        { source: 'a'.repeat(4096), target: 'b'.repeat(4096) },
      ]),
    ).toHaveLength(1);
  });

  it.each(
    [
      null,
      {},
      [null],
      [[]],
      [{}],
      [{ source: 'hello' }],
      [{ ...entry, source: 1 }],
      [{ ...entry, target: null }],
      [{ ...entry, source: 'x'.repeat(4097) }],
      [{ ...entry, target: 'x'.repeat(4097) }],
      [{ ...entry, source: 'a\0b' }],
      [{ ...entry, extra: true }],
      Array.from({ length: MAX_GLOSSARY_ENTRIES + 1 }, () => entry),
    ].map((input) => [input]),
  )('rejects invalid or unbounded input: %p', (input) => {
    expect(() => validateGlossary(input)).toThrow(BadRequestException);
  });

  it('rejects oversized writes rather than silently truncating them', async () => {
    const config = new ConfigService();
    const get = jest.spyOn(config, 'get');
    await expect(
      new GlossaryService(config).save(
        Array.from({ length: MAX_GLOSSARY_ENTRIES + 1 }, () => entry),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(get).not.toHaveBeenCalled();
  });

  it('validates every entry before accessing persistence', async () => {
    const config = new ConfigService();
    const get = jest.spyOn(config, 'get');
    await expect(
      new GlossaryService(config).save([
        entry,
        { source: 'x', target: 'x'.repeat(4097) },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(get).not.toHaveBeenCalled();
  });

  it('writes the entire valid collection', async () => {
    const config = new ConfigService({ subsync: { dataDir: '/data' } });
    const mkdir = jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const write = jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    try {
      await new GlossaryService(config).save([entry]);
      expect(write).toHaveBeenCalledWith(
        expect.stringContaining('glossary.json'),
        JSON.stringify({ entries: [entry] }, null, 2),
        'utf8',
      );
    } finally {
      mkdir.mockRestore();
      write.mockRestore();
    }
  });
});
