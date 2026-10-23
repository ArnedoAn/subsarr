import { buildDocument, type SubtitleDocument } from './subtitle-document';
export class VttBuilder {
  build(
    document: SubtitleDocument,
    translations = document.cues.map((cue) => cue.text),
  ): string {
    return buildDocument(document, translations);
  }
}
