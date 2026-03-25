import { type SrtCue } from './srt-parser';

export class SrtBuilder {
  build(cues: SrtCue[]): string {
    const blocks = cues.map((cue) => {
      return `${cue.index}\n${cue.start} --> ${cue.end}\n${cue.text}`;
    });

    return `${blocks.join('\n\n')}\n`;
  }
}
