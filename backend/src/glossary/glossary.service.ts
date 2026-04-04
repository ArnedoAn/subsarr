import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import type { GlossaryEntry, GlossaryFile } from './glossary.types';

const MAX_ENTRIES = 500;

@Injectable()
export class GlossaryService {
  constructor(private readonly configService: ConfigService) {}

  private filePath(): string {
    const c = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!c) {
      throw new Error('Missing subsync config');
    }
    return path.join(c.dataDir, 'glossary.json');
  }

  async list(): Promise<GlossaryEntry[]> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8');
      const parsed = JSON.parse(raw) as GlossaryFile;
      return Array.isArray(parsed.entries) ? parsed.entries.slice(0, MAX_ENTRIES) : [];
    } catch {
      return [];
    }
  }

  async save(entries: GlossaryEntry[]): Promise<void> {
    const fp = this.filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const body: GlossaryFile = { entries: entries.slice(0, MAX_ENTRIES) };
    await fs.writeFile(fp, JSON.stringify(body, null, 2), 'utf8');
  }

  /** Compact block for LLM system prompt (max 500 entries). */
  async formatForPrompt(): Promise<string> {
    const entries = await this.list();
    if (entries.length === 0) {
      return '';
    }
    const lines = entries.map(
      (e) => `- ${JSON.stringify(e.source)} → ${JSON.stringify(e.target)}`,
    );
    return `Terminology (use when appropriate):\n${lines.join('\n')}\n\n`;
  }
}
