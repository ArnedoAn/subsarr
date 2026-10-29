import * as os from 'node:os';
import * as path from 'node:path';
import { subsyncConfig } from './subsync.config';

describe('subsync provider environment configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      SUBSYNC_DATA_DIR: os.tmpdir(),
      SUBSYNC_SETTINGS_FILE_PATH: path.join(os.tmpdir(), 'settings.json'),
      SUBSYNC_MEDIA_DIRS: os.tmpdir(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('preserves OpenRouter as default with an unconfigured Go key and glm-5.2', () => {
    expect(subsyncConfig()).toMatchObject({
      defaultProvider: 'openrouter',
      opencodeGoApiKey: '',
      opencodeGoModel: 'glm-5.2',
      watchEnabled: false,
    });
  });

  it.each(['openrouter', 'deepseek', 'opencode-go'])(
    'accepts canonical default provider %s without requiring credentials',
    (provider) => {
      process.env.SUBSYNC_DEFAULT_PROVIDER = provider;
      expect(subsyncConfig().defaultProvider).toBe(provider);
    },
  );

  it('loads the Go API key and a documented chat model', () => {
    process.env.OPENCODE_GO_API_KEY = 'go-environment-key';
    process.env.OPENCODE_GO_MODEL = 'kimi-k2.7-code';
    process.env.SUBSYNC_DEFAULT_PROVIDER = 'opencode-go';
    expect(subsyncConfig()).toMatchObject({
      opencodeGoApiKey: 'go-environment-key',
      opencodeGoModel: 'kimi-k2.7-code',
      defaultProvider: 'opencode-go',
    });
  });

  it.each(['', 'unknown', 'OpenCode Go', ' openrouter', 'openrouter\n'])(
    'rejects noncanonical default providers: %p',
    (provider) => {
      process.env.SUBSYNC_DEFAULT_PROVIDER = provider;
      expect(() => subsyncConfig()).toThrow('SUBSYNC_DEFAULT_PROVIDER');
    },
  );

  it.each(['', ' ', 'unsupported-model', 'glm-5.2\n', 'a'.repeat(129)])(
    'rejects invalid or unsupported Go model IDs even when Go is not default: %p',
    (model) => {
      process.env.OPENCODE_GO_MODEL = model;
      expect(() => subsyncConfig()).toThrow();
    },
  );

  it.each(['key\nheader', 'key\rheader', 'key\0header', 'a'.repeat(4097)])(
    'rejects unsafe or oversized Go API keys: %p',
    (key) => {
      process.env.OPENCODE_GO_API_KEY = key;
      expect(() => subsyncConfig()).toThrow('OPENCODE_GO_API_KEY');
    },
  );

  it.each(['true', 'false'])('loads the explicit watcher flag %s', (value) => {
    process.env.SUBSYNC_WATCH_ENABLED = value;
    expect(subsyncConfig().watchEnabled).toBe(value === 'true');
  });

  it.each(['', '1', 'yes', 'TRUE'])(
    'rejects ambiguous watcher flags %p',
    (value) => {
      process.env.SUBSYNC_WATCH_ENABLED = value;
      expect(() => subsyncConfig()).toThrow('SUBSYNC_WATCH_ENABLED');
    },
  );
});
