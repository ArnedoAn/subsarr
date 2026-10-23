import { ProviderLimiter, throwIfAborted } from './provider-limiter';
describe('ProviderLimiter', () => {
  it('shares bounded FIFO capacity and removes cancelled waiters without leaking permits', async () => {
    const limiter = new ProviderLimiter(1, 2);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: number[] = [];
    const first = limiter.run(async () => {
      order.push(1);
      await gate;
    });
    const controller = new AbortController();
    const second = limiter.run(() => {
      order.push(2);
      return Promise.resolve();
    }, controller.signal);
    const rejection = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    });
    const third = limiter.run(() => {
      order.push(3);
      return Promise.resolve();
    });
    await expect(limiter.run(() => Promise.resolve())).rejects.toThrow(
      'queue is full',
    );
    controller.abort();
    await rejection;
    release();
    await Promise.all([first, third]);
    expect(order).toEqual([1, 3]);
    await limiter.run(() => {
      order.push(4);
      return Promise.resolve();
    });
    expect(order).toEqual([1, 3, 4]);
  });
  it('releases permits on rejection and never invokes already aborted work', async () => {
    const limiter = new ProviderLimiter(1);
    await expect(
      limiter.run(() => Promise.reject(new Error('failed'))),
    ).rejects.toThrow('failed');
    const controller = new AbortController();
    controller.abort();
    const operation = jest.fn<Promise<void>, []>();
    await expect(
      limiter.run(operation, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled();
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
  it('wraps non-Error abort reasons while retaining the original cause', async () => {
    const controller = new AbortController();
    const reason = { requestedBy: 'user' };
    controller.abort(reason);
    expect(() => throwIfAborted(controller.signal)).toThrow(
      'Translation cancelled',
    );
    const limiter = new ProviderLimiter(1);
    await expect(
      limiter.run(() => Promise.resolve(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError', cause: reason });
  });
});
