import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  async listDirectory(dirPath: string): Promise<FileSystemEntry[]> {
    try {
      // Basic security check to prevent escaping
      const normalizedPath = path.normalize(dirPath);
      
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
      
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(normalizedPath, entry.name).replace(/\/g, '/') // Ensure consistent separators
      })).sort((a, b) => {
        // Directories first
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      this.logger.error(`Error listing directory ${dirPath}: ${error.message}`);
      return [];
    }
  }
}
