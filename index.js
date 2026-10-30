'use strict';

const PLUGIN_NAME = 'homebridge-datums-schalter';
const PLATFORM_NAME = 'DatumsSchalter';

const TYPES = {
  switch: 'Schalter',
  occupancy: 'Anwesenheitssensor',
  motion: 'Bewegungsmelder',
};

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

/** Normalisiert Eingaben wie "2026-12-24", "24.12.2026" oder "2026-12-24T00:00" auf "YYYY-MM-DD" */
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

/**
 * Prüft, ob ein Gerät heute aktiv ist.
 * @returns {boolean|null} true/false oder null bei ungültiger Konfiguration
 */
function isActive(device, now = new Date()) {
  const today = todayString(now);
  const yearly = !!device.yearly;

  if ((device.mode || 'single') === 'single') {
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

function describe(device) {
  const yearly = device.yearly ? ' (jährlich)' : '';
  if ((device.mode || 'single') === 'single') {
    return `am ${device.date}${yearly}`;
  }
  return `von ${device.startDate} bis ${device.endDate}${yearly}`;
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

    this.api.on('didFinishLaunching', () => this.setup());
    this.api.on('shutdown', () => {
      if (this.timer) {
        clearInterval(this.timer);
      }
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

    this.update();
    // Jede Minute prüfen – fängt Mitternacht, Zeitumstellung und Uhrkorrekturen zuverlässig ab
    this.timer = setInterval(() => this.update(), 60 * 1000);
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
      .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

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
    const active = isActive(this.cfg, now);
    if (active === null) {
      if (!this.warned) {
        this.platform.log.warn(`"${this.cfg.name}": Datum fehlt oder ist ungültig (${describe(this.cfg)}) – Gerät bleibt aus.`);
        this.warned = true;
      }
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
