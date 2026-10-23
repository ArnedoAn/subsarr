import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LibraryQueryDto } from './library-query.dto';

describe('LibraryQueryDto boolean flags', () => {
  it.each(['true', 'false'])(
    'accepts explicit %s for both flags',
    async (value) => {
      const query = plainToInstance(LibraryQueryDto, {
        includeRules: value,
        missingTarget: value,
      });
      expect(await validate(query)).toEqual([]);
    },
  );

  it.each(['1', '0', 'TRUE', 'FALSE'])(
    'rejects ambiguous %s rather than reversing filter semantics',
    async (value) => {
      const query = plainToInstance(LibraryQueryDto, {
        includeRules: value,
        missingTarget: value,
      });
      expect(
        (await validate(query)).map((error) => error.property).sort(),
      ).toEqual(['includeRules', 'missingTarget']);
    },
  );
});
