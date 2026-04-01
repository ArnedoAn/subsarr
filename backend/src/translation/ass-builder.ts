import { type AssLine } from './ass-parser';

export class AssBuilder {
  build(lines: AssLine[]): string {
    const out = lines.map((line) => {
      if (line.kind === 'verbatim') {
        return line.line;
      }
      return `${line.prefix},${line.text}`;
    });
    const body = out.join('\n');
    return body.endsWith('\n') ? body : `${body}\n`;
  }
}
