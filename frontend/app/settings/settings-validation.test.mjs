import assert from 'node:assert/strict';
import test from 'node:test';
import { NUMERIC_SETTINGS, validateNumericSettings } from './settings-validation.ts';

function drafts() {
  const values = Object.fromEntries(Object.entries(NUMERIC_SETTINGS).map(([key, bounds]) => [key, String(bounds.min)]));
  values.scanCacheTtlMinutes = '15';
  return values;
}

test('validates a field even when its section is not currently rendered', () => {
  const values = drafts();
  values.concurrency = '17';
  const error = validateNumericSettings(values);
  assert.equal(error.key, 'concurrency');
  assert.equal(error.section, 'advanced');
});

test('empty optional limits clear without becoming a zero budget', () => {
  const values = drafts();
  values.monthlyBudgetUsd = '';
  values.dailyTokenLimitFree = '';
  values.dailyTokenLimitPaid = '';
  values.fileTooLargeBytes = '';
  assert.equal(validateNumericSettings(values), null);
});

test('zero budgets and fractional prices are valid intentional values', () => {
  const values = drafts();
  values.monthlyBudgetUsd = '0';
  values.deepSeekInputCacheHitUsdPerMillion = '0.028';
  assert.equal(validateNumericSettings(values), null);
});

test('rejects blank required values, non-finite values and fractional whole-token limits', () => {
  for (const [key, value] of [['concurrency', ''], ['deepSeekOutputUsdPerMillion', 'Infinity'], ['dailyTokenLimitPaid', '1.5'], ['scanCacheTtlMinutes', '0'], ['fileTooLargeBytes', '0']]) {
    const values = drafts();
    values[key] = value;
    assert.equal(validateNumericSettings(values).key, key);
  }
});

test('browser badInput empty strings never clear a budget, even after section unmount', () => {
  const values = drafts();
  values.monthlyBudgetUsd = '';
  const invalid = validateNumericSettings(values, { monthlyBudgetUsd: true });
  assert.equal(invalid.key, 'monthlyBudgetUsd');
  assert.equal(invalid.section, 'providers');
  assert.equal(validateNumericSettings(values, { monthlyBudgetUsd: false }), null);
});
