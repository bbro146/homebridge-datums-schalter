'use strict';
const assert = require('assert');
const { isActive, normalizeDate } = require('./index');

const d = (s) => new Date(`${s}T12:00:00`);

// Einzeldatum
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24' }, d('2026-12-24')), true);
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24' }, d('2026-12-25')), false);
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24' }, d('2027-12-24')), false);
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24', yearly: true }, d('2027-12-24')), true);
assert.strictEqual(isActive({ mode: 'single', date: '24.12.2026' }, d('2026-12-24')), true);

// Zeitraum
const r = { mode: 'range', startDate: '2026-12-20', endDate: '2027-01-06' };
assert.strictEqual(isActive(r, d('2026-12-19')), false);
assert.strictEqual(isActive(r, d('2026-12-20')), true);
assert.strictEqual(isActive(r, d('2027-01-01')), true);
assert.strictEqual(isActive(r, d('2027-01-06')), true);
assert.strictEqual(isActive(r, d('2027-01-07')), false);

// Zeitraum jährlich über Jahreswechsel
const ry = { ...r, yearly: true };
assert.strictEqual(isActive(ry, d('2030-12-31')), true);
assert.strictEqual(isActive(ry, d('2030-01-03')), true);
assert.strictEqual(isActive(ry, d('2030-06-01')), false);

// Mitternacht: 23:59 am Vortag aus, 00:00 an
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24' }, new Date(2026, 11, 23, 23, 59)), false);
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24' }, new Date(2026, 11, 24, 0, 0)), true);
assert.strictEqual(isActive({ mode: 'single', date: '2026-12-24' }, new Date(2026, 11, 24, 23, 59)), true);

// Ungültig
assert.strictEqual(isActive({ mode: 'single' }, d('2026-12-24')), null);
assert.strictEqual(isActive({ mode: 'range', startDate: '2026-12-24', endDate: '2026-12-01' }, d('2026-12-10')), null);
assert.strictEqual(normalizeDate('2026-02-30'), null);
assert.strictEqual(normalizeDate('2028-02-29'), '2028-02-29');

console.log('Alle Tests bestanden ✔');
