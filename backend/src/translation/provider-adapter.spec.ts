const mockCreate = jest.fn<Promise<unknown>, [unknown, unknown?]>();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: (body: unknown, options: unknown) => mockCreate(body, options),
      },
    },
  })),
}));
import OpenAI from 'openai';
import { ProviderAdapter, type ProviderRequest } from './provider-adapter';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const reply = {
  choices: [
    { finish_reason: 'stop', message: { content: '{"data":["Hola"]}' } },
  ],
  usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
};
const request: ProviderRequest = {
  provider: 'opencode-go',
  apiKey: 'go-key',
  model: 'glm-5.2',
  system: 'Return JSON',
  user: 'Hello',
  sessionId: '594ffef6-d163-4a35-9610-1e571a18d448',
};
describe('OpenCode Go adapter', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    jest.mocked(OpenAI).mockClear();
  });
  it('limits Go to two requests globally, including distinct adapter instances', async () => {
    const gates = [
      deferred<typeof reply>(),
      deferred<typeof reply>(),
      deferred<typeof reply>(),
    ];
    const firstTwo = deferred<void>();
    let calls = 0;
    mockCreate.mockImplementation(() => {
      const current = calls++;
      if (calls === 2) firstTwo.resolve(undefined);
      return gates[current].promise;
    });
    const first = new ProviderAdapter();
    const second = new ProviderAdapter();
    const pending = [
      first.request(request),
      first.request(request),
      second.request(request),
    ];
    await firstTwo.promise;
    expect(mockCreate).toHaveBeenCalledTimes(2);
    gates[0].resolve(reply);
    await pending[0];
    gates[1].resolve(reply);
    gates[2].resolve(reply);
    await Promise.all(pending);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
  it('reuses a credential client but rotates keys without leaking the document session', async () => {
    mockCreate.mockResolvedValue(reply);
    const adapter = new ProviderAdapter();
    await adapter.request(request);
    await adapter.request({
      ...request,
      sessionId: 'c83e0cc4-e20f-45c2-8b1d-2ba745d9cd99',
    });
    await adapter.request({ ...request, apiKey: 'rotated-go-key' });
    expect(OpenAI).toHaveBeenCalledTimes(2);
    expect(OpenAI).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'rotated-go-key', maxRetries: 0 }),
    );
    expect(mockCreate.mock.calls[0][1]).toMatchObject({
      headers: { 'x-opencode-session': request.sessionId },
    });
    expect(mockCreate.mock.calls[1][1]).toMatchObject({
      headers: { 'x-opencode-session': 'c83e0cc4-e20f-45c2-8b1d-2ba745d9cd99' },
    });
  });
  it('does not start a queued Go call after cancellation', async () => {
    const gate = deferred<typeof reply>();
    const firstTwo = deferred<void>();
    mockCreate.mockImplementation(() => {
      if (mockCreate.mock.calls.length === 2) firstTwo.resolve(undefined);
      return gate.promise;
    });
    const adapter = new ProviderAdapter();
    const active = [adapter.request(request), adapter.request(request)];
    await firstTwo.promise;
    const controller = new AbortController();
    const queued = adapter.request({ ...request, signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    gate.resolve(reply);
    await Promise.all(active);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
