export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface GlossaryFile {
  entries: GlossaryEntry[];
}
