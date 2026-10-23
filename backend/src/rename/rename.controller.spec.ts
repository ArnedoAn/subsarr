import { RenameController } from './rename.controller';
import { RenameMetadataService } from './rename-metadata.service';
import { RenameService } from './rename.service';

describe('RenameController metadata application', () => {
  it('merges selected metadata with pending classification before rendering a year-dependent template', async () => {
    const revise = jest.fn().mockResolvedValue({ id: 'revised-plan' });
    // Controller seams isolate metadata selection from filesystem execution.
    const rename = {
      dryRun: () =>
        Promise.resolve({
          rows: [
            {
              id: 'video',
              sidecar: false,
              classification: {
                kind: 'unknown',
                title: 'Unidentified',
                confidence: 'low',
              },
            },
          ],
        }),
      revise,
    } as unknown as RenameService;
    const metadata = {
      select: () => ({
        id: 'match',
        kind: 'movie',
        title: 'Selected movie',
        year: 2020,
        source: 'jellyfin',
      }),
    } as unknown as RenameMetadataService;
    const controller = new RenameController(rename, metadata);
    await controller.select({
      planId: 'plan',
      rowId: 'video',
      matchId: 'match',
      edits: [
        {
          id: 'video',
          classification: {
            kind: 'movie',
            title: 'Unidentified',
            confidence: 'manual',
          },
        },
        { id: 'sidecar', selected: false },
      ],
    });
    expect(revise).toHaveBeenCalledWith('plan', [
      { id: 'sidecar', selected: false },
      {
        id: 'video',
        classification: {
          kind: 'movie',
          title: 'Selected movie',
          year: 2020,
          confidence: 'manual',
        },
      },
    ]);
  });
});
