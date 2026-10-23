import { parseDocument } from './subtitle-document';
export interface AssDialogueLine {
  kind: 'dialogue';
  prefix: string;
  text: string;
  ending?: string;
}
export interface AssVerbatimLine {
  kind: 'verbatim';
  line: string;
  ending?: string;
}
export type AssLine = AssDialogueLine | AssVerbatimLine;
export function splitAssDialogueBody(
  body: string,
): { prefix: string; text: string } | null {
  let offset = 0;
  for (let i = 0; i < 9; i++) {
    const comma = body.indexOf(',', offset);
    if (comma < 0) return null;
    offset = comma + 1;
  }
  return {
    prefix: 'Dialogue: ' + body.slice(0, offset - 1),
    text: body.slice(offset),
  };
}
export class AssParser {
  parse(input: string): AssLine[] {
    const document = parseDocument(input, 'ass');
    const cues = new Map(document.cues.map((cue) => [cue.textEnd, cue]));
    const result: AssLine[] = [];
    for (const match of input.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
      if (!match[0]) break;
      const cue = cues.get(match.index + match[1].length);
      result.push(
        cue
          ? {
              kind: 'dialogue',
              prefix: input.slice(match.index, cue.textStart - 1),
              text: cue.text,
              ending: match[2],
            }
          : { kind: 'verbatim', line: match[1], ending: match[2] },
      );
    }
    return result;
  }
}
