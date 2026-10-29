import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticBasename, diagnosticDuration, diagnosticText, numericDiagnostics } from './diagnostics.ts';

test('diagnostics remove connection credentials, bearer tokens and assigned secrets', () => {
  const text = diagnosticText('Redis redis://user:pass@host:6379 password=hunter2 api_key="private value" token=abcdef Bearer abc.def sk-1234567890');
  for (const secret of ['user:pass', 'hunter2', 'private value', 'abcdef', 'abc.def', 'sk-1234567890']) assert.equal(text.includes(secret), false);
  assert.match(text, /redacted/);
  assert.equal(diagnosticText('Database unavailable; migrations pending'), 'Database unavailable; migrations pending');
});

test('diagnostics redact JSON-shaped credentials and database connection errors', () => {
  const text = diagnosticText('{"api_key":"private key value","token":"jwt-secret","password":"db-secret"} postgres://admin:databasepass@db:5432/app AMQPS://guest:queuepass@queue SK-uppercasekey123');
  for (const secret of ['private key value', 'jwt-secret', 'db-secret', 'databasepass', 'queuepass', 'SK-uppercasekey123']) assert.equal(text.includes(secret), false);
  assert.match(text, /connection redacted/);
});

test('basename-only presentation handles both platforms and root paths', () => {
  assert.equal(diagnosticBasename('/private/media/movie.mkv'), 'movie.mkv');
  assert.equal(diagnosticBasename('D:\\private\\movie.mkv'), 'movie.mkv');
  assert.equal(diagnosticBasename('/'), '(root)');
  assert.equal(diagnosticBasename('/media/series/'), 'series');
});

test('numeric diagnostic counters exclude malformed values without losing zero', () => {
  assert.deepEqual(numericDiagnostics({ hits: 0, elapsed: 12.5, bad: NaN, infinity: Infinity, negative: -1, state: 'ok', nested: { count: 1 } }), [['hits', 0], ['elapsed', 12.5]]);
});

test('duration formatting uses milliseconds then seconds and rejects invalid durations', () => {
  assert.equal(diagnosticDuration(0), '0 ms');
  assert.equal(diagnosticDuration(999), '999 ms');
  assert.equal(diagnosticDuration(1250), '1.3 s');
  for (const value of [-1, NaN, Infinity]) assert.equal(diagnosticDuration(value), 'Unavailable');
});
