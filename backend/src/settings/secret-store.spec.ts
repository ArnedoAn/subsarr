import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SecretStore } from './secret-store';

describe('SecretStore', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-secret-'));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('atomically shares a private generated key across concurrent instances and restarts', async () => {
    const stores = [
      new SecretStore(directory, ''),
      new SecretStore(directory, ''),
    ];
    const encrypted = await Promise.all(
      stores.map((store) => store.encrypt('keep-this-secret', 'tmdbApiKey')),
    );
    expect(encrypted[0]).not.toContain('keep-this-secret');
    expect(encrypted[0]).not.toEqual(encrypted[1]);
    const restart = new SecretStore(directory, '');
    for (const value of encrypted)
      expect(await restart.decrypt(value, 'tmdbApiKey')).toBe(
        'keep-this-secret',
      );
    expect(
      (await fs.readFile(path.join(directory, 'subsarr-secret.key'))).length,
    ).toBe(32);
    if (process.platform !== 'win32')
      expect(
        (await fs.stat(path.join(directory, 'subsarr-secret.key'))).mode &
          0o777,
      ).toBe(0o600);
    expect(await fs.readdir(directory)).toEqual(['subsarr-secret.key']);
  });

  it('authenticates the secret field, ciphertext, and configured key', async () => {
    const store = new SecretStore(directory, 'ab'.repeat(32));
    const encrypted = await store.encrypt('real-secret', 'openRouterApiKey');
    await expect(store.decrypt(encrypted, 'deepSeekApiKey')).rejects.toThrow();
    await expect(
      new SecretStore(directory, 'cd'.repeat(32)).decrypt(
        encrypted,
        'openRouterApiKey',
      ),
    ).rejects.toThrow();
    const bytes = Buffer.from(encrypted.slice('enc:v1:'.length), 'base64');
    bytes[bytes.length - 1] ^= 1;
    await expect(
      store.decrypt(`enc:v1:${bytes.toString('base64')}`, 'openRouterApiKey'),
    ).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rejects invalid key configuration without persisting secrets', async () => {
    await expect(
      new SecretStore(directory, 'weak').encrypt('secret', 'telegramBotToken'),
    ).rejects.toThrow('32 bytes');
    expect(await fs.readdir(directory)).toEqual([]);
  });
});
