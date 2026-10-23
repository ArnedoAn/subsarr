import { parseDocument, type SubtitleDocument } from './subtitle-document';
export class VttParser {
  parse(input: string): SubtitleDocument {
    return parseDocument(input, 'vtt');
  }
}
