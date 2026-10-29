'use strict';

// Run after the backend build, against a disposable Redis database (REDIS_URL).
// Everything else, including the encryption key, lives under a temporary directory.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createDecipheriv } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');
const { DatabaseSync } = require('node:sqlite');

const backend = path.resolve(__dirname, '../backend');
const backendRequire = createRequire(path.join(backend, 'package.json'));
const Redis = backendRequire('ioredis');
const main = path.join(backend, 'dist/main.js');
const legacySecrets = {
  openRouterApiKey: 'upgrade-fixture-router-not-a-real-key',
  deepSeekApiKey: 'upgrade-fixture-deepseek-not-a-real-key',
  telegramBotToken: 'upgrade-fixture-telegram-not-a-real-token',
  jellyfinApiKey: 'upgrade-fixture-jellyfin-not-a-real-key',
};

async function seed(filename, media) {
  const database = new DatabaseSync(filename);
  try {
    const { InitialSchema1738700000000 } = backendRequire('./dist/migrations/1738700000000-InitialSchema.js');
    await new InitialSchema1738700000000().up({
      query: async (sql) => database.exec(sql),
    });
    database.exec('CREATE TABLE migrations (id integer PRIMARY KEY AUTOINCREMENT, timestamp bigint NOT NULL, name varchar NOT NULL)');
    database.prepare('INSERT INTO migrations (timestamp, name) VALUES (?, ?)').run(1738700000000, 'InitialSchema1738700000000');
    const settings = {
      id: 'main', mediaDirsJson: JSON.stringify([media]), sourceLanguage: 'eng',
      targetLanguage: 'spa', ...legacySecrets, openRouterModel: 'openrouter/free',
      deepSeekModel: 'deepseek-chat', scanCacheTtlMinutes: 30, concurrency: 1,
      pathContainsExclusionsJson: '[]', translationVerificationEnabled: 0,
      rulesJson: '[]', autoScanEnabled: 0, autoTranslateNewItems: 0,
      telegramEnabled: 0, telegramEventsJson: '[]',
    };
    const columns = Object.keys(settings);
    database.prepare(`INSERT INTO settings (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(settings));
    database.prepare('INSERT INTO token_usage (tier,date,promptTokens,completionTokens,totalTokens) VALUES (?,?,?,?,?)').run('paid', '2025-01-02', 100, 50, 150);
    database.prepare('INSERT INTO token_usage (tier,date,promptTokens,completionTokens,totalTokens) VALUES (?,?,?,?,?)').run('free', '2025-01-02', 20, 10, 30);
    const now = Date.now();
    database.prepare('INSERT INTO job_snapshots (id,state,dataJson,progress,returnValueJson,createdAt,finishedAt,logsJson) VALUES (?,?,?,?,?,?,?,?)').run('upgrade-fixture-completed', 'completed', JSON.stringify({ mediaId: 'upgrade-fixture-media', sourceLanguage: 'eng', targetLanguage: 'spa' }), 100, JSON.stringify({ outputPath: 'fixture.spa.srt' }), now - 1000, now, '[]');
  } finally {
    database.close();
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  // Windows does not deliver POSIX SIGTERM. The IPC shim emits the same signal
  // to Nest so its registered shutdown hooks run before the process terminates.
  if (process.platform === 'win32') child.send('upgrade:SIGTERM');
  else child.kill('SIGTERM');
  let timer;
  try {
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Backend did not shut down within 15 seconds')), 15000); }),
    ]);
    const [code, signal] = result;
    assert.ok(code === 0 || signal === 'SIGTERM' || (process.platform === 'win32' && code === 1), `Unexpected shutdown: code=${code}, signal=${signal}`);
  } catch (error) {
    child.kill('SIGKILL');
    await exited;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function boot(environment) {
  const port = await freePort();
  const args = process.platform === 'win32'
    ? ['-e', "process.on('message', message => { if (message === 'upgrade:SIGTERM') process.emit('SIGTERM'); }); require(process.argv[1]);", main]
    : [main];
  const child = spawn(process.execPath, args, {
    cwd: environment.SUBSYNC_DATA_DIR,
    env: { ...environment, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (bytes) => { output = (output + bytes.toString()).slice(-20000); });
  child.stderr.on('data', (bytes) => { output = (output + bytes.toString()).slice(-20000); });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Backend exited before readiness');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/system/preflight`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) {
          const report = await response.json();
          assert.equal(report.database.accessible, true);
          assert.equal(report.database.migrationsPending, false);
          assert.equal(report.redis.ready, true);
          assert.equal(report.providers.keys.openrouter, true);
          assert.equal(report.providers.keys.deepseek, true);
          return;
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      await delay(150);
    }
    throw new Error('Timed out waiting for backend preflight');
  } catch (error) {
    // Only fixture credentials are present in this isolated process.
    throw new Error(`${error.message}\n${output}`);
  } finally {
    await stop(child);
  }
}

async function snapshot(filename, directory) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const migrations = database.prepare('SELECT timestamp,name FROM migrations ORDER BY timestamp').all();
    const expected = (await fs.readdir(path.join(backend, 'dist/migrations')))
      .filter((name) => /^\d+-[^.]+\.js$/.test(name)).map((name) => Number(name.split('-')[0])).sort();
    assert.deepEqual(migrations.map((row) => row.timestamp), expected);
    const settings = database.prepare("SELECT * FROM settings WHERE id='main'").get();
    assert.ok(settings, 'Original settings row was lost');
    const key = await fs.readFile(path.join(directory, 'subsarr-secret.key'));
    assert.equal(key.length, 32);
    for (const [field, original] of Object.entries(legacySecrets)) {
      const encrypted = settings[field];
      assert.ok(encrypted.startsWith('enc:v1:'), `${field} was not encrypted`);
      const bytes = Buffer.from(encrypted.slice(7), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(field));
      decipher.setAuthTag(bytes.subarray(12, 28));
      assert.equal(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), original);
    }
    assert.equal(settings.defaultProvider, 'openrouter');
    assert.equal(settings.opencodeGoModel, 'glm-5.2');
    const tokens = database.prepare('SELECT * FROM token_usage ORDER BY tier,date').all();
    assert.equal(tokens.length, 2);
    assert.equal(tokens.find((row) => row.tier === 'paid').totalTokens, 150);
    assert.equal(tokens.find((row) => row.tier === 'paid').cacheMissTokens, 100);
    assert.ok(tokens.find((row) => row.tier === 'paid').costUsd > 0);
    assert.equal(tokens.find((row) => row.tier === 'free').totalTokens, 30);
    const jobs = database.prepare('SELECT * FROM job_snapshots ORDER BY id').all();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'upgrade-fixture-completed');
    assert.equal(jobs[0].state, 'completed');
    assert.equal(JSON.parse(jobs[0].dataJson).mediaId, 'upgrade-fixture-media');
    const schema = database.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    return { migrations, settings, tokens, jobs, schema, key: key.toString('hex') };
  } finally {
    database.close();
  }
}

async function run() {
  assert.ok(process.env.REDIS_URL, 'Set REDIS_URL to a disposable Redis database (for example redis://127.0.0.1:6379/15)');
  await fs.access(main);
  const redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  let directory;
  let ownsQueue = false;
  try {
    try {
      await redis.connect();
      assert.equal(await redis.ping(), 'PONG');
    } catch {
      throw new Error('Redis is not reachable; use a disposable reachable database in REDIS_URL');
    }
    assert.equal((await redis.keys('bull:translation:*')).length, 0, 'Redis translation queue is not empty; use a disposable Redis database');
    ownsQueue = true;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-upgrade-'));
    const media = path.join(directory, 'media');
    await fs.mkdir(media);
    const filename = path.join(directory, 'subsarr.db');
    await seed(filename, media);
    const environment = { ...process.env };
    // Never inherit real credentials or application paths. cwd is also isolated
    // so Nest cannot load the developer backend .env file.
    for (const name of Object.keys(environment)) {
      if (/^(SUBSYNC_|SUBSARR_|OPENROUTER_|DEEPSEEK_|OPENCODE_|TELEGRAM_|JELLYFIN_|TMDB_)/.test(name)) delete environment[name];
    }
    Object.assign(environment, {
      NODE_ENV: 'test', SUBSYNC_DATA_DIR: directory,
      SUBSYNC_DATABASE_PATH: filename,
      SUBSYNC_SETTINGS_FILE_PATH: path.join(directory, 'settings.json'),
      SUBSYNC_MEDIA_DIRS: media, SUBSYNC_WATCH_ENABLED: 'false',
      OPENROUTER_API_KEY: '', DEEPSEEK_API_KEY: '', OPENCODE_GO_API_KEY: '',
    });
    await boot(environment);
    const first = await snapshot(filename, directory);
    await boot(environment);
    const second = await snapshot(filename, directory);
    assert.deepEqual(second, first, 'Second boot modified schema, migrations, secrets, tokens or archived jobs');
    console.log(`Upgrade check passed: oldest schema → ${first.migrations.length} migrations; encrypted legacy secrets, token rows and job snapshot preserved; second boot is a no-op; SIGTERM shutdown completed.`);
  } finally {
    if (ownsQueue && redis.status === 'ready') {
      const keys = await redis.keys('bull:translation:*');
      if (keys.length) await redis.del(...keys);
    }
    redis.disconnect();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`Upgrade check failed: ${error.message}`);
  process.exitCode = 1;
});
