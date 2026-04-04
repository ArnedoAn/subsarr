import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import type { ProfilesFile, TranslationProfile } from './profile.types';

@Injectable()
export class ProfilesService {
  constructor(private readonly configService: ConfigService) {}

  private filePath(): string {
    const c = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!c) {
      throw new Error('Missing subsync config');
    }
    return path.join(c.dataDir, 'profiles.json');
  }

  async list(): Promise<TranslationProfile[]> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8');
      const parsed = JSON.parse(raw) as ProfilesFile;
      return Array.isArray(parsed.profiles) ? parsed.profiles : [];
    } catch {
      return [];
    }
  }

  async save(profiles: TranslationProfile[]): Promise<void> {
    const fp = this.filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const body: ProfilesFile = { profiles };
    await fs.writeFile(fp, JSON.stringify(body, null, 2), 'utf8');
  }
}
