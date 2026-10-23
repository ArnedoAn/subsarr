import { type AssLine } from './ass-parser';
export class AssBuilder {
  build(lines: AssLine[]): string {
    return lines
      .map(
        (line) =>
          (line.kind === 'verbatim'
            ? line.line
            : `${line.prefix},${line.text}`) + (line.ending ?? '\n'),
      )
      .join('');
  }
}
