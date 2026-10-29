export class DownloadStability {
  private readonly observations = new Map<
    string,
    { size: number; mtimeMs: number; stableSince: number }
  >();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit = 100_000,
  ) {}

  pending(file: string, size: number, mtimeMs: number): boolean {
    const now = this.now();
    const previous = this.observations.get(file);
    const changed =
      previous && (previous.size !== size || previous.mtimeMs !== mtimeMs);
    const stableSince = changed ? now : (previous?.stableSince ?? mtimeMs);
    // An unobserved old file is ready immediately. Changed files must remain
    // unchanged for a full window even when a downloader preserves old mtimes.
    if (!previous && this.observations.size >= this.limit) {
      this.observations.delete(this.observations.keys().next().value);
    }
    this.observations.set(file, { size, mtimeMs, stableSince });
    return now - mtimeMs < 30_000 || now - stableSince < 30_000;
  }

  retain(files: ReadonlySet<string>): void {
    for (const file of this.observations.keys()) {
      if (!files.has(file)) this.observations.delete(file);
    }
  }
}

export function isPartialDownload(name: string): boolean {
  return /\.(?:part|partial|crdownload|tmp)(?:\.|$)/i.test(name);
}
