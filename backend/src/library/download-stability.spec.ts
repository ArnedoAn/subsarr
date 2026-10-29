import { DownloadStability } from './download-stability';

describe('DownloadStability', () => {
  it('probes old files immediately but requires an unchanged window after mutation', () => {
    let now = 100_000;
    const stability = new DownloadStability(() => now);
    expect(stability.pending('movie', 10, 0)).toBe(false);
    expect(stability.pending('movie', 20, 0)).toBe(true);
    now += 29_999;
    expect(stability.pending('movie', 20, 0)).toBe(true);
    now++;
    expect(stability.pending('movie', 20, 0)).toBe(false);
    expect(stability.pending('movie', 20, 1000)).toBe(true);
  });

  it('cleans removed observations and bounds retained paths', () => {
    const stability = new DownloadStability(() => 100_000, 2);
    stability.pending('a', 1, 0);
    expect(stability.pending('a', 2, 0)).toBe(true);
    stability.retain(new Set());
    expect(stability.pending('a', 2, 0)).toBe(false);
    expect(stability.pending('a', 3, 0)).toBe(true);
    stability.pending('b', 1, 0);
    stability.pending('c', 1, 0);
    expect(stability.pending('a', 3, 0)).toBe(false);
  });
});
