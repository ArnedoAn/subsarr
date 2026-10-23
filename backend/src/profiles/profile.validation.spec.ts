import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { ProfilesService } from './profiles.service';
import { MAX_PROFILES, validateProfiles } from './profile.validation';

const profile = {
  id: '47cd98f8-a057-4b43-a654-11d6759a9650',
  name: 'Films',
  pathPrefix: '/media/films',
  sourceLanguage: 'en',
  targetLanguage: 'de',
};

describe('validateProfiles', () => {
  it('accepts empty and complete profiles without mutating input', () => {
    expect(validateProfiles([])).toEqual([]);
    const input = [{ ...profile, provider: 'openrouter' }];
    expect(validateProfiles(input)).toEqual(input);
    expect(validateProfiles(input)[0]).not.toBe(input[0]);
  });

  it.each(
    [
      null,
      {},
      [null],
      [[]],
      [{ ...profile, id: 'not-a-uuid' }],
      [{ ...profile, name: ' ' }],
      [{ ...profile, name: 'a'.repeat(201) }],
      [{ ...profile, pathPrefix: 'a'.repeat(4097) }],
      [{ ...profile, sourceLanguage: 'a'.repeat(65) }],
      [{ ...profile, targetLanguage: 123 }],
      [{ ...profile, provider: null }],
      [{ ...profile, provider: 'invalid' }],
      [{ ...profile, extra: true }],
      [{ ...profile, pathPrefix: '/media\0path' }],
      [profile, profile],
      Array.from({ length: MAX_PROFILES + 1 }, () => profile),
    ].map((input) => [input]),
  )('rejects invalid or unbounded input: %p', (input) => {
    expect(() => validateProfiles(input)).toThrow(BadRequestException);
  });

  it('validates before any filesystem operations on the service path', async () => {
    const config = new ConfigService();
    const get = jest.spyOn(config, 'get');
    const service = new ProfilesService(config);
    await expect(service.save([{ ...profile, name: '' }])).rejects.toThrow(
      BadRequestException,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('persists the validated profile collection', async () => {
    const config = new ConfigService({ subsync: { dataDir: '/data' } });
    const mkdir = jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const write = jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    try {
      await new ProfilesService(config).save([profile]);
      expect(write).toHaveBeenCalledWith(
        expect.stringContaining('profiles.json'),
        JSON.stringify({ profiles: [profile] }, null, 2),
        'utf8',
      );
      expect(mkdir).toHaveBeenCalled();
    } finally {
      mkdir.mockRestore();
      write.mockRestore();
    }
  });
});
