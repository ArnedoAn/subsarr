import { parseDocument } from './subtitle-document';
export interface SrtCue {
  index: number;
  start: string;
  end: string;
  text: string;
}
export class SrtParser {
  parse(input: string): SrtCue[] {
    return parseDocument(input, 'srt').cues.map(
      ({ index, start, end, text }) => ({ index, start, end, text }),
    );
  }
}
