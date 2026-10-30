'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'homebridge-datums-schalter';
const PLATFORM_NAME = 'DatumsSchalter';
const VERSION = require('./package.json').version;

const TYPES = {
  switch: 'Schalter',
  occupancy: 'Anwesenheitssensor',
  motion: 'Bewegungsmelder',
};

const STATES = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

// Schlüsselwörter für den optionalen Ferien-Filter
const HOLIDAY_KINDS = {
  winter: 'winter',
  oster: 'oster',
  pfingst: 'pfingst',
  sommer: 'sommer',
  herbst: 'herbst',
  weihnacht: 'weihnacht',
};

const REFRESH_MS = 12 * 60 * 60 * 1000; // Feriendaten alle 12 Stunden aktualisieren
const RETRY_MS = 30 * 60 * 1000; // nach Fehler in 30 Minuten erneut versuchen

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, DatumsSchalterPlatform);
};

// ---------- Datums-Hilfsfunktionen (lokale Zeit des Homebridge-Servers) ----------

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Heutiges Datum als "YYYY-MM-DD" in der lokalen Zeitzone des Servers */
function todayString(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Normalisiert "2026-12-24", "24.12.2026" oder "2026-12-24T00:00" auf "YYYY-MM-DD" */
function normalizeDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return checkValid(+m[1], +m[2], +m[3]);
  }
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return checkValid(+m[3], +m[2], +m[1]);
  }
  return null;
}

function checkValid(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    // 29.02. bei jährlicher Wiederholung trotzdem zulassen
    if (!(mo === 2 && d === 29)) {
      return null;
    }
  }
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Tage auf ein "YYYY-MM-DD" addieren (zeitzonenneutral) */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = So, 6 = Sa
}

function isWeekend(dateStr) {
  const w = weekday(dateStr);
  return w === 0 || w === 6;
}

/** Ferienzeitraum um direkt angrenzende Wochenenden erweitern */
function extendToWeekends(h) {
  let start = h.start;
  let end = h.end;
  while (isWeekend(addDays(start, -1))) {
    start = addDays(start, -1);
  }
  while (isWeekend(addDays(end, 1))) {
    end = addDays(end, 1);
  }
  return { ...h, start, end };
}

/** Ferienliste für ein Gerät filtern und ggf. um Wochenenden erweitern */
function holidaysForDevice(device, holidays) {
  if (!Array.isArray(holidays)) {
    return null;
  }
  const kinds = Array.isArray(device.holidayKinds) ? device.holidayKinds.filter((k) => HOLIDAY_KINDS[k]) : [];
  let list = holidays;
  if (kinds.length) {
    list = list.filter((h) => kinds.some((k) => (h.name || '').toLowerCase().includes(HOLIDAY_KINDS[k])));
  }
  if (device.includeWeekends) {
    list = list.map(extendToWeekends);
  }
  return list;
}

/**
 * Prüft, ob ein Gerät heute aktiv ist.
 * @param holidays Ferienliste [{name,start,end}] für den Modus "schoolHolidays"
 * @returns {boolean|null} true/false oder null bei fehlender/ungültiger Konfiguration bzw. Daten
 */
function isActive(device, now = new Date(), holidays) {
  const today = todayString(now);
  const mode = device.mode || 'single';

  if (mode === 'schoolHolidays') {
    const list = holidaysForDevice(device, holidays);
    if (!list) {
      return null;
    }
    return list.some((h) => today >= h.start && today <= h.end);
  }

  const yearly = !!device.yearly;

  if (mode === 'single') {
    const date = normalizeDate(device.date);
    if (!date) {
      return null;
    }
    return yearly ? today.slice(5) === date.slice(5) : today === date;
  }

  const start = normalizeDate(device.startDate);
  const end = normalizeDate(device.endDate);
  if (!start || !end) {
    return null;
  }

  if (!yearly) {
    if (start > end) {
      return null;
    }
    return today >= start && today <= end;
  }

  // Jährlich: nur Monat/Tag vergleichen, auch über den Jahreswechsel (z. B. 20.12. – 06.01.)
  const t = today.slice(5);
  const s = start.slice(5);
  const e = end.slice(5);
  return s <= e ? t >= s && t <= e : t >= s || t <= e;
}

function fmt(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function describe(device) {
  const mode = device.mode || 'single';
  if (mode === 'schoolHolidays') {
    const kinds = Array.isArray(device.holidayKinds) && device.holidayKinds.length ? ` (nur: ${device.holidayKinds.join(', ')})` : '';
    const we = device.includeWeekends ? ', inkl. angrenzender Wochenenden' : '';
    return `in den Schulferien ${STATES[device.state] || device.state || '?'}${kinds}${we}`;
  }
  const yearly = device.yearly ? ' (jährlich)' : '';
  if (mode === 'single') {
    return `am ${device.date}${yearly}`;
  }
  return `von ${device.startDate} bis ${device.endDate}${yearly}`;
}

// ---------- Feriendaten abrufen ----------

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': `${PLUGIN_NAME}/${VERSION}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/** Primärquelle: OpenHolidays API (openholidaysapi.org) */
async function fetchOpenHolidays(state, from, to) {
  const url =
    'https://openholidaysapi.org/SchoolHolidays' +
    `?countryIsoCode=DE&subdivisionCode=DE-${state}&languageIsoCode=DE&validFrom=${from}&validTo=${to}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) {
    throw new Error('unerwartetes Antwortformat');
  }
  return data
    .map((e) => {
      const names = Array.isArray(e.name) ? e.name : [];
      const de = names.find((n) => (n.language || '').toUpperCase() === 'DE') || names[0];
      return {
        name: (de && de.text) || 'Ferien',
        start: normalizeDate(e.startDate),
        end: normalizeDate(e.endDate),
      };
    })
    .filter((h) => h.start && h.end && h.start <= h.end);
}

/** Ersatzquelle: ferien-api.de */
async function fetchFerienApi(state, years) {
  const all = [];
  for (const y of years) {
    const data = await fetchJson(`https://ferien-api.de/api/v1/holidays/${state}/${y}`);
    if (!Array.isArray(data)) {
      throw new Error('unerwartetes Antwortformat');
    }
    data.forEach((e) => {
      const start = normalizeDate(e.start);
      const end = normalizeDate(e.end);
      if (start && end && start <= end) {
        const n = String(e.name || 'Ferien');
        all.push({ name: n.charAt(0).toUpperCase() + n.slice(1), start, end });
      }
    });
  }
  return all;
}

async function loadHolidays(state, now = new Date()) {
  const from = addDays(todayString(now), -120);
  const to = addDays(todayString(now), 600);
  try {
    const list = await fetchOpenHolidays(state, from, to);
    if (list.length) {
      return { source: 'openholidaysapi.org', holidays: list };
    }
    throw new Error('keine Einträge');
  } catch (e1) {
    const y = now.getFullYear();
    try {
      const list = await fetchFerienApi(state, [y - 1, y, y + 1]);
      if (list.length) {
        return { source: 'ferien-api.de', holidays: list, warning: `OpenHolidays: ${e1.message}` };
      }
      throw new Error('keine Einträge');
    } catch (e2) {
      throw new Error(`OpenHolidays: ${e1.message}; ferien-api.de: ${e2.message}`);
    }
  }
}

function dedupe(list) {
  const seen = new Set();
  return list
    .filter((h) => {
      const k = `${h.start}|${h.end}|${h.name}`;
      return seen.has(k) ? false : seen.add(k);
    })
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

// ---------- Plattform ----------

class DatumsSchalterPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.cachedAccessories = new Map();
    this.devices = [];
    this.timer = null;
    this.holidayTimer = null;

    this.holidayCache = {}; // { SN: { fetched, source, holidays: [] } }
    this.cacheFile = path.join(api.user.storagePath(), 'datums-schalter-ferien.json');

    this.api.on('didFinishLaunching', () => this.setup());
    this.api.on('shutdown', () => {
      clearInterval(this.timer);
      clearTimeout(this.holidayTimer);
    });
  }

  configureAccessory(accessory) {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  setup() {
    const list = Array.isArray(this.config.devices) ? this.config.devices : [];
    const usedUUIDs = new Set();

    list.forEach((cfg, index) => {
      if (!cfg || !cfg.name) {
        this.log.warn(`Gerät #${index + 1} hat keinen Namen und wird übersprungen.`);
        return;
      }
      const type = TYPES[cfg.type] ? cfg.type : 'switch';
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${type}:${cfg.name}`);
      if (usedUUIDs.has(uuid)) {
        this.log.warn(`"${cfg.name}" (${TYPES[type]}) ist doppelt vorhanden und wird übersprungen.`);
        return;
      }
      usedUUIDs.add(uuid);

      let accessory = this.cachedAccessories.get(uuid);
      const isNew = !accessory;
      if (isNew) {
        accessory = new this.api.platformAccessory(cfg.name, uuid);
      }
      accessory.context.device = { ...cfg, type };

      const device = new DatumsGeraet(this, accessory);
      this.devices.push(device);

      if (isNew) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info(`Neu angelegt: "${cfg.name}" als ${TYPES[type]} – aktiv ${describe(cfg)}`);
      } else {
        this.api.updatePlatformAccessories([accessory]);
        this.log.info(`Geladen: "${cfg.name}" als ${TYPES[type]} – aktiv ${describe(cfg)}`);
      }
    });

    // Nicht mehr konfigurierte Geräte entfernen
    const stale = [...this.cachedAccessories.values()].filter((a) => !usedUUIDs.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      stale.forEach((a) => this.log.info(`Entfernt: "${a.displayName}"`));
    }

    // Schulferien: Cache laden, dann aktualisieren
    if (this.neededStates().length) {
      this.readCache();
      this.refreshHolidays();
    }

    this.update();
    // Jede Minute prüfen – fängt Mitternacht, Zeitumstellung und Uhrkorrekturen zuverlässig ab
    this.timer = setInterval(() => this.update(), 60 * 1000);
  }

  neededStates() {
    const states = new Set();
    this.devices.forEach((d) => {
      if (d.cfg.mode === 'schoolHolidays' && STATES[d.cfg.state]) {
        states.add(d.cfg.state);
      }
    });
    return [...states];
  }

  holidaysFor(state) {
    const entry = this.holidayCache[state];
    return entry ? entry.holidays : null;
  }

  readCache() {
    try {
      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (data && typeof data === 'object') {
        this.holidayCache = data;
        this.log.debug('Feriendaten aus dem Cache geladen.');
      }
    } catch (e) {
      // noch kein Cache vorhanden
    }
  }

  writeCache() {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.holidayCache, null, 2));
    } catch (e) {
      this.log.warn(`Ferien-Cache konnte nicht gespeichert werden: ${e.message}`);
    }
  }

  async refreshHolidays() {
    clearTimeout(this.holidayTimer);
    let failed = false;

    for (const state of this.neededStates()) {
      try {
        const result = await loadHolidays(state);
        const holidays = dedupe(result.holidays);
        this.holidayCache[state] = { fetched: new Date().toISOString(), source: result.source, holidays };
        if (result.warning) {
          this.log.warn(`Ersatzquelle genutzt (${result.warning}).`);
        }
        const today = todayString();
        const next = holidays.filter((h) => h.end >= today).slice(0, 3);
        this.log.info(
          `Schulferien ${STATES[state]} aktualisiert (${result.source}, ${holidays.length} Einträge). Nächste: ` +
            (next.length ? next.map((h) => `${h.name} ${fmt(h.start)}–${fmt(h.end)}`).join(' | ') : 'keine'),
        );
      } catch (e) {
        failed = true;
        const cached = this.holidayCache[state];
        this.log.warn(
          `Schulferien ${STATES[state]} konnten nicht abgerufen werden (${e.message}). ` +
            (cached ? `Verwende gespeicherte Daten vom ${fmt(cached.fetched.slice(0, 10))}.` : 'Noch keine gespeicherten Daten vorhanden.'),
        );
      }
    }

    this.writeCache();
    this.update();
    this.holidayTimer = setTimeout(() => this.refreshHolidays(), failed ? RETRY_MS : REFRESH_MS);
  }

  update() {
    const now = new Date();
    this.devices.forEach((d) => d.refresh(now));
  }
}

// ---------- Einzelnes Gerät ----------

class DatumsGeraet {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.cfg = accessory.context.device;
    this.state = false;
    this.warned = false;

    const { Service, Characteristic } = platform;

    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'bbro146')
      .setCharacteristic(Characteristic.Model, `Datums-${TYPES[this.cfg.type]}`)
      .setCharacteristic(Characteristic.SerialNumber, accessory.UUID.slice(0, 13))
      .setCharacteristic(Characteristic.FirmwareRevision, VERSION);

    // Falls der Typ geändert wurde: alte Services entfernen
    const wanted = this.serviceClass();
    [Service.Switch, Service.OccupancySensor, Service.MotionSensor].forEach((cls) => {
      if (cls !== wanted) {
        const old = accessory.getService(cls);
        if (old) {
          accessory.removeService(old);
        }
      }
    });

    this.service = accessory.getService(wanted) || accessory.addService(wanted, this.cfg.name);
    this.service.setCharacteristic(Characteristic.Name, this.cfg.name);
    if (Characteristic.ConfiguredName) {
      try {
        if (!this.service.testCharacteristic(Characteristic.ConfiguredName)) {
          this.service.addOptionalCharacteristic(Characteristic.ConfiguredName);
        }
        this.service.setCharacteristic(Characteristic.ConfiguredName, this.cfg.name);
      } catch (e) {
        // ältere HAP-Versionen – ignorieren
      }
    }

    const ch = this.characteristic();
    ch.onGet(() => this.hapValue());

    if (this.cfg.type === 'switch') {
      // Schalter folgt ausschließlich dem Datum – manuelles Umschalten wird zurückgesetzt
      ch.onSet((value) => {
        if (!!value !== this.state) {
          this.platform.log.info(`"${this.cfg.name}" wird über das Datum gesteuert – manuelle Änderung zurückgesetzt.`);
          setTimeout(() => ch.updateValue(this.hapValue()), 500);
        }
      });
    }
  }

  serviceClass() {
    const { Service } = this.platform;
    return { switch: Service.Switch, occupancy: Service.OccupancySensor, motion: Service.MotionSensor }[this.cfg.type];
  }

  characteristic() {
    const { Characteristic } = this.platform;
    const c = {
      switch: Characteristic.On,
      occupancy: Characteristic.OccupancyDetected,
      motion: Characteristic.MotionDetected,
    }[this.cfg.type];
    return this.service.getCharacteristic(c);
  }

  hapValue() {
    if (this.cfg.type === 'occupancy') {
      const O = this.platform.Characteristic.OccupancyDetected;
      return this.state ? O.OCCUPANCY_DETECTED : O.OCCUPANCY_NOT_DETECTED;
    }
    return this.state;
  }

  refresh(now) {
    let active;
    if (this.cfg.mode === 'schoolHolidays') {
      if (!STATES[this.cfg.state]) {
        active = null;
      } else {
        const holidays = this.platform.holidaysFor(this.cfg.state);
        // Noch keine Daten (Abruf läuft) → aus, ohne Warnung
        active = holidays ? isActive(this.cfg, now, holidays) : false;
      }
    } else {
      active = isActive(this.cfg, now);
    }

    if (active === null && !this.warned) {
      const msg =
        this.cfg.mode === 'schoolHolidays'
          ? 'kein gültiges Bundesland ausgewählt'
          : `Datum fehlt oder ist ungültig (${describe(this.cfg)})`;
      this.platform.log.warn(`"${this.cfg.name}": ${msg} – Gerät bleibt aus.`);
      this.warned = true;
    }

    const next = active === true;
    if (next !== this.state) {
      this.state = next;
      this.platform.log.info(`"${this.cfg.name}" ist jetzt ${next ? 'AKTIV' : 'aus'}.`);
    }
    this.characteristic().updateValue(this.hapValue());
  }
}

// Für Tests
module.exports.isActive = isActive;
module.exports.normalizeDate = normalizeDate;
module.exports.extendToWeekends = extendToWeekends;
module.exports.loadHolidays = loadHolidays;
