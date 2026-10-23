import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LIBRARY_FILTERS, libraryHistoryChange, libraryQuery, parseLibraryFilters, transitionLibraryFilters } from '../../lib/library-filters-cache.ts';

test('server query preserves exact search and parent-scope filters without client normalization', () => {
  const filters = { ...DEFAULT_LIBRARY_FILTERS, q: 'été "My Show" lang:eng s02e03', folder: '/media/TV', group: 'series:opaque', season: '2', type: 'episode', status: 'eligible', targetLanguage: 'spa', missingTarget: true, page: 6, limit: 100 };
  const page = libraryQuery(filters);
  assert.equal(page.get('q'), filters.q);
  assert.equal(page.get('offset'), '500');
  assert.equal(page.get('limit'), '100');
  const allIds = libraryQuery(filters, false);
  assert.equal(allIds.has('offset'), false);
  assert.equal(allIds.has('limit'), false);
  for (const key of ['q', 'folder', 'group', 'season', 'type', 'status', 'targetLanguage', 'missingTarget']) assert.equal(allIds.get(key), page.get(key));
});

test('URL filters round-trip page, order, movie filter, missing target and opaque group keys', () => {
  const filters = { ...DEFAULT_LIBRARY_FILTERS, q: 'a&b', type: 'movie', group: 'movies:/media/a&b', page: 4, limit: 200, sort: 'date', order: 'desc', missingTarget: true };
  const params = libraryQuery(filters); params.set('page', String(filters.page));
  assert.deepEqual(parseLibraryFilters(params), filters);
});

test('invalid URL pagination and enums cannot produce unbounded requests', () => {
  const filters = parseLibraryFilters(new URLSearchParams('page=Infinity&limit=90000&sort=sql&type=other&status=ready&season=-3'));
  assert.equal(filters.page, 1);
  assert.equal(filters.limit, 50);
  assert.equal(filters.sort, 'name');
  assert.equal(filters.type, '');
  assert.equal(filters.status, '');
  assert.equal(filters.season, '');
  assert.equal(libraryQuery(filters).get('offset'), '0');
});

test('season zero and fractional page links are handled deterministically', () => {
  const filters = parseLibraryFilters(new URLSearchParams('season=0&page=2.9&limit=20'));
  assert.equal(filters.season, '0');
  assert.equal(filters.page, 2);
  assert.equal(libraryQuery(filters).get('offset'), '20');
});

test('initial restoration replaces, explicit page navigation pushes, and Back round-trips the first page', () => {
  const first = { ...DEFAULT_LIBRARY_FILTERS, q: 'show', page: 1 };
  const initial = libraryHistoryChange('', first, true);
  assert.equal(initial.method, 'replaceState');
  const second = transitionLibraryFilters(first, { page: 2 });
  const next = libraryHistoryChange(initial.search, second);
  assert.equal(next.method, 'pushState');
  assert.equal(parseLibraryFilters(new URLSearchParams(next.search)).page, 2);
  const restoredByBack = parseLibraryFilters(new URLSearchParams(initial.search));
  assert.deepEqual(restoredByBack, first);
  assert.equal(libraryHistoryChange(initial.search, restoredByBack).method, null);
});

test('filter/group/season changes reset the page and create distinct meaningful history entries', () => {
  const previous = { ...DEFAULT_LIBRARY_FILTERS, page: 4 };
  const previousUrl = libraryHistoryChange('', previous, true).search;
  const next = transitionLibraryFilters(previous, { group: 'show:opaque', season: '2' });
  assert.equal(next.page, 1);
  const history = libraryHistoryChange(previousUrl, next);
  assert.equal(history.method, 'pushState');
  assert.equal(parseLibraryFilters(new URLSearchParams(history.search)).season, '2');
});

test('unchanged controls never reset pagination or add duplicate history entries', () => {
  const previous = { ...DEFAULT_LIBRARY_FILTERS, page: 3 };
  const next = transitionLibraryFilters(previous, { sort: 'name' });
  assert.equal(next, previous);
  const url = libraryHistoryChange('', previous, true).search;
  assert.equal(libraryHistoryChange(url, next).method, null);
});

test('a committed search resets pagination and retains the exact final query in history', () => {
  const previous = { ...DEFAULT_LIBRARY_FILTERS, page: 3, q: 'old' };
  const query = 'été "exact phrase" s02e03';
  const next = transitionLibraryFilters(previous, { q: query });
  const history = libraryHistoryChange(libraryHistoryChange('', previous, true).search, next);
  assert.equal(history.method, 'pushState');
  assert.equal(next.page, 1);
  assert.equal(parseLibraryFilters(new URLSearchParams(history.search)).q, query);
});
