import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_SELECTION_LIMIT, reviewEdits, reviewPollDelay, reviewTimestamp, reviewWorkspaceLink, toggleReviewCue } from './review-workspace.ts';

test('selection is immutable, ordinal based and bounded across pages', () => {
  const previous = new Set([0, 50]);
  const next = toggleReviewCue(previous, 50);
  assert.deepEqual([...previous], [0, 50]);
  assert.deepEqual([...next], [0]);
  const full = new Set(Array.from({ length: REVIEW_SELECTION_LIMIT }, (_, index) => index));
  assert.equal(toggleReviewCue(full, 500).size, REVIEW_SELECTION_LIMIT);
  assert.equal(toggleReviewCue(full, 0).size, REVIEW_SELECTION_LIMIT - 1);
});

test('only changed loaded ordinals are sent; empty text is not silently discarded', () => {
  const cues = [{ cueIndex: 0, text: 'Same' }, { cueIndex: 7, text: 'Before' }];
  assert.deepEqual(reviewEdits(cues, { 0: 'Same', 7: '', 900: 'stale other page' }), [{ cueIndex: 7, text: '' }]);
  assert.deepEqual(reviewEdits(cues, {}), []);
});

test('workspace links escape opaque IDs and time display preserves milliseconds', () => {
  assert.equal(reviewWorkspaceLink('a/b?x=1&y'), '/review?id=a%2Fb%3Fx%3D1%26y');
  assert.equal(reviewTimestamp(3723004), '01:02:03.004');
  assert.equal(reviewTimestamp(-5), '00:00:00.000');
});

test('poll cancellation rejects before scheduling or while waiting', async () => {
  const before = new AbortController(); before.abort(new Error('already closed'));
  await assert.rejects(reviewPollDelay(before.signal), /already closed/);
  const during = new AbortController();
  const delay = reviewPollDelay(during.signal, 60000);
  during.abort(new Error('closed'));
  await assert.rejects(delay, /closed/);
});
