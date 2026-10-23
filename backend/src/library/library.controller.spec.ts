import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { RulesService } from '../rules/rules.service';
import { OutputService } from '../output/output.service';
import { ExtractionService } from '../extraction/extraction.service';
import { type MediaItem } from './media-item.entity';

function fixture(
  id: string,
  probeStatus: MediaItem['probeStatus'] = 'ok',
): MediaItem {
  return {
    id,
    name: id,
    path: `/media/${id}.mkv`,
    type: 'episode',
    probeStatus,
    subtitleTracks: [],
    externalSubtitles: [],
    size: 1,
    lastModified: new Date(0),
    series: 'Series',
    season: 1,
    episodes: [Number(id)],
    groupKey: 'series',
  };
}

describe('LibraryController query cutover', () => {
  const items = [
    fixture('1'),
    fixture('2'),
    fixture('3'),
    fixture('4', 'failed'),
  ];
  let controller: LibraryController;
  let queryInventory: jest.Mock;

  beforeEach(() => {
    queryInventory = jest
      .fn()
      .mockImplementation((query: { offset?: number; limit?: number }) =>
        Promise.resolve({
          items,
          total: items.length,
          offset: query.offset ?? 0,
          limit: query.limit ?? 50,
        }),
      );
    const library = {
      queryInventory,
      getGroups: jest.fn().mockResolvedValue({
        targetLanguage: 'pl',
        groups: [
          {
            key: 'series',
            label: 'Series',
            type: 'episode',
            count: 4,
            targetPresent: 0,
            missingTarget: 4,
            seasons: [1],
          },
        ],
        folders: ['/media'],
      }),
    };
    const rules = {
      getDefinitions: jest.fn().mockResolvedValue([]),
      getTranslationConfig: jest.fn().mockResolvedValue({}),
      evaluateWithConfig: jest
        .fn()
        .mockImplementation((item: MediaItem) => ({ skip: item.id === '1' })),
    };
    controller = new LibraryController(
      library as unknown as LibraryService,
      rules as unknown as RulesService,
      {} as OutputService,
      {} as ExtractionService,
    );
  });

  it('filters eligibility before slicing and reports the full filtered total', async () => {
    const page = await controller.list({
      status: 'eligible',
      offset: 1,
      limit: 1,
    });
    expect(queryInventory).toHaveBeenCalledWith(
      { status: 'eligible', offset: 1, limit: 1 },
      true,
    );
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual(['3']);
  });

  it('returns all matching IDs even when a page limit was supplied', async () => {
    expect(await controller.ids({ status: 'eligible', limit: 1 })).toEqual({
      ids: ['2', '3'],
    });
    expect(await controller.ids({ status: 'skipped', limit: 1 })).toEqual({
      ids: ['1'],
    });
  });

  it('keeps group counts consistent with eligible selection rather than raw inventory counts', async () => {
    expect(await controller.groups({ status: 'eligible' })).toEqual({
      targetLanguage: 'pl',
      groups: [
        {
          key: 'series',
          label: 'Series',
          type: 'episode',
          count: 2,
          targetPresent: 0,
          missingTarget: 2,
          seasons: [1],
        },
      ],
      folders: ['/media'],
    });
  });
});
