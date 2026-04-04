import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubsyncTempCleanupService {
  private readonly logger = new Logger(SubsyncTempCleanupService.name);

  @Cron(CronExpression.EVERY_HOUR)
  async cleanStaleExtractions(): Promise<void> {
    const root = path.join(tmpdir(), 'subsync');
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const now = Date.now();
      for (const ent of entries) {
        if (!ent.isFile()) {
          continue;
        }
        const full = path.join(root, ent.name);
        try {
          const st = await fs.stat(full);
          if (now - st.mtimeMs > MAX_AGE_MS) {
            await fs.unlink(full);
          }
        } catch {
          /* ignore per-file */
        }
      }
    } catch {
      /* missing dir */
    }
  }
}
