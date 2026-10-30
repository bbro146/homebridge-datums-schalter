'use strict';
const assert = require('assert');
const { isActive, normalizeDate, extendToWeekends } = require('./index');

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

// Schulferien
const H = [
  { name: 'Herbstferien', start: '2026-10-12', end: '2026-10-24' }, // Mo – Sa
  { name: 'Weihnachtsferien', start: '2026-12-21', end: '2027-01-02' },
  { name: 'Sommerferien', start: '2027-07-05', end: '2027-08-13' }, // Mo – Fr
];
const sh = { mode: 'schoolHolidays', state: 'SN' };
assert.strictEqual(isActive(sh, d('2026-10-12'), H), true);
assert.strictEqual(isActive(sh, d('2026-10-24'), H), true);
assert.strictEqual(isActive(sh, d('2026-10-25'), H), false);
assert.strictEqual(isActive(sh, d('2026-12-31'), H), true);
assert.strictEqual(isActive(sh, d('2027-01-03'), H), false);
assert.strictEqual(isActive(sh, d('2026-10-30'), H), false);
assert.strictEqual(isActive(sh, d('2026-10-12'), null), null);

// Filter nur Sommer
const shSommer = { ...sh, holidayKinds: ['sommer'] };
assert.strictEqual(isActive(shSommer, d('2026-10-12'), H), false);
assert.strictEqual(isActive(shSommer, d('2027-07-10'), H), true);

// Wochenenden einbeziehen
assert.deepStrictEqual(extendToWeekends({ start: '2027-07-05', end: '2027-08-13' }), { start: '2027-07-03', end: '2027-08-15' });
assert.deepStrictEqual(extendToWeekends({ start: '2026-10-12', end: '2026-10-24' }), { start: '2026-10-10', end: '2026-10-25' });
const shWe = { ...sh, includeWeekends: true };
assert.strictEqual(isActive(shWe, d('2027-07-03'), H), true);
assert.strictEqual(isActive(shWe, d('2027-08-15'), H), true);
assert.strictEqual(isActive(shWe, d('2027-08-16'), H), false);
assert.strictEqual(isActive(sh, d('2027-07-03'), H), false);

console.log('Alle Tests bestanden ✔');
