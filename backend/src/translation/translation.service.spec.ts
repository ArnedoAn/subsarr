jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));

import { TranslationService } from './translation.service';
import { TranslationVerificationService } from './translation-verification.service';
import { type SettingsService } from '../settings/settings.service';

describe('TranslationService', () => {
  const settingsService = {
    getSettings: jest.fn().mockResolvedValue({
      openRouterModel: 'test/openrouter',
      deepSeekModel: 'test/deepseek',
    }),
  };

  let fetchMock: jest.Mock;
  let service: TranslationService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    settingsService.getSettings.mockClear();
    service = new TranslationService(
      new TranslationVerificationService(),
      settingsService as unknown as SettingsService,
    );
  });

  it('retries and repairs a translated SRT cue that dropped an internal line even when semantic verification is disabled', async () => {
    fetchMock
      .mockResolvedValueOnce(openRouterResponse(['Hola']))
      .mockResolvedValueOnce(openRouterResponse(['Hola\nAlli']));

    const result = await service.translateLines(
      ['Hello\nThere'],
      'spa',
      'openrouter-key',
      'deepseek-key',
      {
        provider: 'openrouter',
        sourceLanguage: 'eng',
        verificationEnabled: false,
        subtitleFormat: 'srt',
      },
    );

    expect(result.lines).toEqual(['Hola\nAlli']);
    expect(result.verification).toMatchObject({
      totalLines: 1,
      failedCount: 0,
      retriedLines: 1,
      fixedByRetry: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<
      [unknown, RequestInit | undefined]
    >;
    const retryBody = calls[1]?.[1]?.body;
    expect(typeof retryBody === 'string' ? retryBody : '').toContain(
      'missing_segments',
    );
  });
});

function openRouterResponse(lines: string[]): {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
} {
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ data: lines }),
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      ),
  };
}
