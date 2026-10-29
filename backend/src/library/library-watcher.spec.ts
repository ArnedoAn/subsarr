import { EventEmitter } from 'node:events';
import { type FSWatcher, type watch } from 'node:fs';
import { LibraryWatcher } from './library-watcher';

class VirtualWatcher extends EventEmitter {
  close = jest.fn();
}

describe('LibraryWatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('coalesces dirty directories for two seconds, caps watches, and closes on shutdown', async () => {
    const handles: VirtualWatcher[] = [];
    const open = jest.fn(() => {
      const handle = new VirtualWatcher();
      handles.push(handle);
      return handle as unknown as FSWatcher;
    }) as unknown as typeof watch;
    const reconcile = jest.fn().mockResolvedValue(undefined);
    const watcher = new LibraryWatcher(true, reconcile, open, 2);
    watcher.visit('/media/a');
    watcher.visit('/media/b');
    watcher.visit('/media/c');
    watcher.markDirty('/media/a');
    watcher.markDirty('/media/a');
    watcher.markDirty('/media/b');
    await jest.advanceTimersByTimeAsync(1999);
    expect(reconcile).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledWith(['/media/a', '/media/b']);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(watcher.status()).toMatchObject({ watching: 2, overflow: 1 });
    watcher.markDirty('/media/a');
    watcher.close();
    await jest.advanceTimersByTimeAsync(2000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(
      handles.every((handle) => handle.close.mock.calls.length === 1),
    ).toBe(true);
  });

  it('queues events that arrive during reconciliation rather than overlapping', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reconcile = jest
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(undefined);
    const open = (() =>
      new VirtualWatcher() as unknown as FSWatcher) as typeof watch;
    const watcher = new LibraryWatcher(true, reconcile, open);
    watcher.visit('/media');
    watcher.markDirty('/media');
    await jest.advanceTimersByTimeAsync(2000);
    watcher.markDirty('/media');
    await jest.advanceTimersByTimeAsync(2000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(2000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    watcher.retain(new Set());
    expect(watcher.status().watching).toBe(0);
    watcher.close();
  });

  it('does not open watches when disabled', () => {
    const open = jest.fn() as unknown as typeof watch;
    const watcher = new LibraryWatcher(
      false,
      () => Promise.resolve(undefined),
      open,
    );
    watcher.visit('/media');
    watcher.markDirty('/media');
    expect(open).not.toHaveBeenCalled();
    expect(watcher.status().dirtyDirectories).toBe(0);
    watcher.close();
  });
});
