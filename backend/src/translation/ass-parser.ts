/**
 * ASS/SSA (V4+): Dialogue lines use nine commas before the Text field.
 * @see https://wiki.multimedia.cx/index.php/Subtitles#Events
 */

export interface AssDialogueLine {
  kind: 'dialogue';
  /** Includes "Dialogue: " and the first nine fields (Layer … Effect), without the comma before Text. */
  prefix: string;
  text: string;
}

export interface AssVerbatimLine {
  kind: 'verbatim';
  line: string;
}

export type AssLine = AssDialogueLine | AssVerbatimLine;

function findNthComma(s: string, n: number): number {
  let count = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === ',') {
      count += 1;
      if (count === n) {
        return i;
      }
    }
  }
  return -1;
}

export function splitAssDialogueBody(body: string): { prefix: string; text: string } | null {
  const idx = findNthComma(body, 9);
  if (idx === -1) {
    return null;
  }
  return {
    prefix: 'Dialogue: ' + body.slice(0, idx),
    text: body.slice(idx + 1),
  };
}

export class AssParser {
  parse(input: string): AssLine[] {
    const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = normalized.split('\n');
    return rawLines.map((line) => this.parseLine(line));
  }

  private parseLine(line: string): AssLine {
    const trimmedStart = line.trimStart();
    if (!/^Dialogue:/i.test(trimmedStart)) {
      return { kind: 'verbatim', line };
    }

    const m = trimmedStart.match(/^Dialogue:\s*(.*)$/s);
    if (!m) {
      return { kind: 'verbatim', line };
    }

    const split = splitAssDialogueBody(m[1] ?? '');
    if (!split) {
      return { kind: 'verbatim', line };
    }

    return {
      kind: 'dialogue',
      prefix: split.prefix,
      text: split.text,
    };
  }
}
