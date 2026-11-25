const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function createDailyDhikrProgress(');
const end = html.indexOf('\nfunction setupDhikr(', start);
assert.notEqual(start, -1, 'daily progress helper exists');
assert.notEqual(end, -1, 'daily progress helper ends before setupDhikr');
const helperSource = html.slice(start, end);
const createDailyDhikrProgress = vm.runInNewContext(
  helperSource + '\ncreateDailyDhikrProgress',
  { Math, Date, JSON, Number, String }
);

const titleStart = html.indexOf('function getDhikrTitle(');
const titleEnd = html.indexOf('\\nfunction setupDhikr(', titleStart);
assert.notEqual(titleStart, -1, 'stable dhikr title helper exists');
assert.notEqual(titleEnd, -1, 'stable dhikr title helper ends before setupDhikr');
const getDhikrTitle = vm.runInNewContext(
  html.slice(titleStart, titleEnd) + '\\ngetDhikrTitle',
  { String }
);
const titleAfterBadge = getDhikrTitle({
  querySelector(selector) {
    assert.equal(selector, ':scope > p.muted');
    return { textContent: 'آية الكرسي' };
  }
});
assert.equal(titleAfterBadge, 'آية الكرسي', 'order badge does not alter the dhikr identity key');

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

assert.equal(day1Key, 'zad-morning-counts-v8-2026-11-23');
assert.equal(morning.get(item1), 0);
morning.set(item1, 1, 1);
morning.set(item19, 100, 100);
assert.equal(morning.get(item1), 1);
assert.equal(morning.get(item19), 100);

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
assert.equal(reopened.getStorageKey(), 'zad-morning-counts-v8-2026-11-24');
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
const malformed = memoryStorage({ 'zad-morning-counts-v8-2026-11-24': '{bad json' });
assert.equal(createDailyDhikrProgress('morning', malformed, now).get(item1), 0);
const arrayData = memoryStorage({ 'zad-morning-counts-v8-2026-11-24': '[]' });
assert.equal(createDailyDhikrProgress('morning', arrayData, now).get(item1), 0);

console.log('PASS: daily reset, same-day resume, item order, morning/evening isolation, clamping, reset, and corrupt-storage handling');
