export interface SrtCue {
  index: number;
  start: string;
  end: string;
  text: string;
}

export class SrtParser {
  parse(input: string): SrtCue[] {
    const normalized = input.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return [];
    }

    const blocks = normalized.split(/\n\n+/);
    const cues: SrtCue[] = [];

    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) {
        continue;
      }

      const index = Number.parseInt(lines[0] ?? '', 10);
      const timing = lines[1] ?? '';
      const timingParts = timing.split(' --> ');
      if (!Number.isFinite(index) || timingParts.length !== 2) {
        continue;
      }

      const text = lines.slice(2).join('\n');
      cues.push({
        index,
        start: timingParts[0],
        end: timingParts[1],
        text,
      });
    }

    return cues;
  }
}
