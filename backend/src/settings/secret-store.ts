import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const PREFIX = 'enc:v1:';
export const SECRET_FIELDS = [
  'openRouterApiKey',
  'deepSeekApiKey',
  'opencodeGoApiKey',
  'telegramBotToken',
  'jellyfinApiKey',
  'tmdbApiKey',
] as const;
export type SecretField = (typeof SECRET_FIELDS)[number];

/** One process-local key promise; exclusive creation never replaces an existing key. */
export class SecretStore {
  private keyPromise?: Promise<Buffer>;
  constructor(
    private readonly dataDir: string,
    private readonly configuredKey = process.env.SUBSARR_SECRET_KEY,
  ) {}

  private key(): Promise<Buffer> {
    return (this.keyPromise ??= this.loadKey());
  }

  private async loadKey(): Promise<Buffer> {
    if (this.configuredKey) {
      const value = this.configuredKey.trim();
      const key = /^[a-f0-9]{64}$/i.test(value)
        ? Buffer.from(value, 'hex')
        : Buffer.from(value, 'base64');
      if (
        key.length !== 32 ||
        (!/^[a-f0-9]{64}$/i.test(value) && key.toString('base64') !== value)
      ) {
        throw new Error(
          'SUBSARR_SECRET_KEY must be 32 bytes encoded as hex or canonical base64',
        );
      }
      return key;
    }
    await fs.mkdir(this.dataDir, { recursive: true });
    const filename = path.join(this.dataDir, 'subsarr-secret.key');
    const candidate = randomBytes(32);
    // Write a complete private file first, then atomically link it into place.
    const temporary = `${filename}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    await fs.writeFile(temporary, candidate, { flag: 'wx', mode: 0o600 });
    try {
      try {
        await fs.link(temporary, filename);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      await fs.unlink(temporary);
    }
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Secret key must be a regular file');
    await fs.chmod(filename, 0o600);
    const key = await fs.readFile(filename);
    if (key.length !== 32) throw new Error('Invalid Subsarr secret key file');
    return key;
  }

  async encrypt(value: string, field: string): Promise<string> {
    if (!value) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    cipher.setAAD(Buffer.from(field));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return (
      PREFIX +
      Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
    );
  }

  async decrypt(value: string, field: string): Promise<string> {
    if (!value?.startsWith(PREFIX)) return value;
    const bytes = Buffer.from(value.slice(PREFIX.length), 'base64');
    if (bytes.length < 29) throw new Error('Invalid encrypted secret');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await this.key(),
      bytes.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(field));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
  }
}

export function isMaskedSecret(value: string): boolean {
  return /[*•]{3,}/.test(value);
}
