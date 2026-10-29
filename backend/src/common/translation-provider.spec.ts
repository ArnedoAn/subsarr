import {
  resolveProviderModel,
  validateProviderModel,
} from './translation-provider';

const settings = {
  defaultProvider: 'opencode-go' as const,
  openRouterModel: 'openrouter/free',
  deepSeekModel: 'deepseek-chat',
  opencodeGoModel: 'glm-5.2',
};

describe('provider and model selection', () => {
  it('uses operation, then profile, then default provider with matching models', () => {
    expect(resolveProviderModel(settings)).toEqual({
      provider: 'opencode-go',
      model: 'glm-5.2',
    });
    expect(
      resolveProviderModel(
        settings,
        {},
        { provider: 'deepseek', model: 'deepseek-reasoner' },
      ),
    ).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner' });
    expect(
      resolveProviderModel(
        settings,
        { provider: 'openrouter' },
        { provider: 'deepseek', model: 'deepseek-reasoner' },
      ),
    ).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    expect(resolveProviderModel(settings, { model: 'kimi-k3' })).toEqual({
      provider: 'opencode-go',
      model: 'kimi-k3',
    });
  });

  it('preserves legacy defaults and rejects blank, unsafe, and incompatible models', () => {
    expect(
      resolveProviderModel({
        openRouterModel: 'openrouter/free',
        deepSeekModel: 'deepseek-chat',
      }).provider,
    ).toBe('openrouter');
    for (const model of ['', ' ', '../secret', 'a\nheader', 'x'.repeat(129)])
      expect(() => validateProviderModel(undefined, model)).toThrow();
    expect(() => validateProviderModel('opencode-go', 'claude-sonnet')).toThrow(
      'OpenAI-compatible chat',
    );
    expect(() => resolveProviderModel(settings, { model: '' })).toThrow();
  });
});
