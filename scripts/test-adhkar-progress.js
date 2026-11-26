const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function createDailyDhikrProgress(');
const end = html.indexOf('\nfunction setupDhikr(', start);
assert.notEqual(start, -1, 'daily progress helper exists');
assert.notEqual(end, -1, 'daily progress helper ends before setupDhikr');
const createDailyDhikrProgress = vm.runInNewContext(
  html.slice(start, end) + '\ncreateDailyDhikrProgress',
  { Math, Date, JSON, Number, String }
);

const titleStart = html.indexOf('function getDhikrTitle(');
const titleEnd = html.indexOf('\nfunction setupDhikr(', titleStart);
assert.notEqual(titleStart, -1, 'stable dhikr title helper exists');
assert.notEqual(titleEnd, -1, 'stable dhikr title helper ends before setupDhikr');
const getDhikrTitle = vm.runInNewContext(
  html.slice(titleStart, titleEnd) + '\ngetDhikrTitle',
  { String }
);
const titleAfterBadge = getDhikrTitle({
  querySelector(selector) {
    assert.equal(selector, ':scope > p.muted');
    return { textContent: 'آية الكرسي' };
  }
});
assert.equal(titleAfterBadge, 'آية الكرسي', 'order badge does not alter the dhikr identity key');

const normalizeStart = html.indexOf('function normalizeDhikrSequence(');
const normalizeEnd = html.indexOf('\nfunction setupDhikr(', normalizeStart);
assert.notEqual(normalizeStart, -1, 'sequence recovery helper exists');
assert.notEqual(normalizeEnd, -1, 'sequence recovery helper ends before setupDhikr');
const normalizeDhikrSequence = vm.runInNewContext(
  html.slice(normalizeStart, normalizeEnd) + '\nnormalizeDhikrSequence',
  { Math }
);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    has(key) { return data.has(key); },
    raw(key) { return data.get(key); }
  };
}

let today = new Date(2026, 10, 23, 8, 0, 0);
const now = () => new Date(today);
const storage = memoryStorage();
const morning = createDailyDhikrProgress('morning', storage, now);
const item1 = 'آية الكرسي|نص الآية';
const item19 = 'سبحان الله وبحمده|النص';
const day1Key = morning.getStorageKey();

assert.equal(day1Key, 'zad-morning-counts-v9-2026-11-23');
assert.equal(morning.get(item1), 0);
morning.set(item1, 1, 1);
morning.set(item19, 100, 100);
assert.equal(morning.get(item1), 1);
assert.equal(morning.get(item19), 100);

// The new storage version must not trust potentially stale v8 progress.
const legacy = memoryStorage({
  'zad-morning-counts-v8-2026-11-23': JSON.stringify({ [item1]: 1, [item19]: 100 })
});
const cleanVersion = createDailyDhikrProgress('morning', legacy, now);
assert.equal(cleanVersion.getStorageKey(), day1Key);
assert.equal(cleanVersion.get(item1), 0);
assert.equal(cleanVersion.get(item19), 0);
assert.equal(legacy.has('zad-morning-counts-v8-2026-11-23'), true, 'legacy data is retained, not deleted');

// Closing and reopening on the same day must preserve that day's progress.
const reopened = createDailyDhikrProgress('morning', storage, now);
assert.equal(reopened.get(item1), 1);
assert.equal(reopened.get(item19), 100);
const items = Array.from({ length: 25 }, (_, i) => i === 0 ? item1 : i === 18 ? item19 : 'dhikr-' + (i + 1));
const firstIncomplete = items.findIndex((key, i) => reopened.get(key) < (i === 18 ? 100 : 1));
assert.equal(firstIncomplete, 1, 'same-day resume continues at item 2, not a later stale item');

// A new local calendar day must start with zero progress and leave yesterday intact.
today = new Date(2026, 10, 24, 0, 1, 0);
assert.equal(reopened.ensureCurrentDay(), true);
assert.equal(reopened.getStorageKey(), 'zad-morning-counts-v9-2026-11-24');
assert.equal(reopened.get(item1), 0);
assert.equal(reopened.get(item19), 0);
assert.equal(storage.has(day1Key), true, 'yesterday data is retained, not overwritten');
reopened.set(item1, 1, 1);
assert.equal(reopened.get(item1), 1);

// Morning and evening progress are isolated from each other.
const evening = createDailyDhikrProgress('evening', storage, now);
assert.equal(evening.get(item1), 0);
evening.set(item1, 3, 3);
assert.equal(reopened.get(item1), 1);
assert.equal(evening.get(item1), 3);

// Values are clamped to the repetition target and reset only today's key.
evening.set(item19, 999, 100);
assert.equal(evening.get(item19), 100);
const eveningKey = evening.getStorageKey();
evening.reset();
assert.equal(evening.get(item1), 0);
assert.equal(storage.has(eveningKey), false);

// Invalid and array-shaped saved data are ignored safely.
const malformed = memoryStorage({ 'zad-morning-counts-v9-2026-11-24': '{bad json' });
assert.equal(createDailyDhikrProgress('morning', malformed, now).get(item1), 0);
const arrayData = memoryStorage({ 'zad-morning-counts-v9-2026-11-24': '[]' });
assert.equal(createDailyDhikrProgress('morning', arrayData, now).get(item1), 0);

// A stale later item must be cleared until every earlier item is complete.
const sequenceKeys = ['ayat', 'ikhlas', 'falaq', 'nas'];
const sequenceCounts = new Map([['ayat', 1], ['ikhlas', 0], ['falaq', 2], ['nas', 1]]);
const sequenceProgress = {
  get(key) { return sequenceCounts.get(key) || 0; },
  set(key, value, maximum) { sequenceCounts.set(key, Math.min(maximum, Math.max(0, Number(value) || 0))); }
};
const keyOf = item => item;
const required = [1, 3, 3, 3];
assert.equal(normalizeDhikrSequence(sequenceKeys, required, sequenceProgress, keyOf), 1);
assert.deepEqual(sequenceKeys.map(key => sequenceProgress.get(key)), [1, 0, 0, 0]);
assert.equal(normalizeDhikrSequence(sequenceKeys, required, sequenceProgress, keyOf), 1, 'recovery is idempotent');

sequenceProgress.set('ikhlas', 3, 3);
sequenceProgress.set('falaq', 2, 3);
sequenceProgress.set('nas', 1, 3);
assert.equal(normalizeDhikrSequence(sequenceKeys, required, sequenceProgress, keyOf), 2);
assert.deepEqual(sequenceKeys.map(key => sequenceProgress.get(key)), [1, 3, 0, 0]);

sequenceProgress.set('falaq', 3, 3);
sequenceProgress.set('nas', 1, 3);
assert.equal(normalizeDhikrSequence(sequenceKeys, required, sequenceProgress, keyOf), 3);
assert.deepEqual(sequenceKeys.map(key => sequenceProgress.get(key)), [1, 3, 3, 0]);
sequenceProgress.set('nas', 3, 3);
assert.equal(normalizeDhikrSequence(sequenceKeys, required, sequenceProgress, keyOf), -1, 'fully completed sequence remains completed');

console.log('PASS: storage versioning, daily reset, same-day resume, sequence recovery, morning/evening isolation, clamping, reset, and corrupt-storage handling');
