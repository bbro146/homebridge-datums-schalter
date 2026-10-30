# homebridge-datums-schalter

Homebridge-Plugin (Homebridge 1.8+ und 2.x) für **Schalter, Anwesenheitssensoren und Bewegungsmelder, die sich nach dem Datum richten**.

Für jedes Gerät gibst du entweder ein **einzelnes Datum** oder einen **Zeitraum (von – bis)** an. Ab 00:00 Uhr des Datums ist das Gerät aktiv, nach 23:59 Uhr des (letzten) Tages geht es automatisch wieder aus. Du kannst beliebig viele Geräte anlegen.

## Funktionen

- Gerätetypen: **Schalter**, **Anwesenheitssensor**, **Bewegungsmelder**
- **Einzeldatum** oder **Zeitraum** (Start- und Enddatum jeweils inklusive)
- Optional **jährlich wiederholen** – nur Tag und Monat zählen, Zeiträume über den Jahreswechsel (z. B. 20.12. – 06.01.) funktionieren
- Maßgeblich ist das **Datum des Homebridge-Servers**; geprüft wird jede Minute
- Komplett über die Homebridge-Oberfläche konfigurierbar
- Gelöschte Geräte werden automatisch aus HomeKit entfernt

Ein Schalter folgt ausschließlich dem Datum: Schaltest du ihn in der Home-App manuell um, springt er auf den richtigen Zustand zurück. Ideal als Bedingung oder Auslöser in Automationen.

## Installation

Über die Homebridge-Oberfläche nach `homebridge-datums-schalter` suchen, oder:

```bash
npm install -g homebridge-datums-schalter
```

## Konfiguration

```json
{
  "platform": "DatumsSchalter",
  "name": "Datums-Schalter",
  "devices": [
    { "name": "Silvester", "type": "switch", "mode": "single", "date": "2026-12-31" },
    { "name": "Weihnachtszeit", "type": "occupancy", "mode": "range",
      "startDate": "2026-12-20", "endDate": "2027-01-06", "yearly": true },
    { "name": "Urlaub", "type": "motion", "mode": "range",
      "startDate": "2027-07-01", "endDate": "2027-07-14" }
  ]
}
```

| Feld | Werte | Beschreibung |
|---|---|---|
| `name` | Text | Name des Geräts in HomeKit |
| `type` | `switch`, `occupancy`, `motion` | Gerätetyp |
| `mode` | `single`, `range` | Einzeldatum oder Zeitraum |
| `date` | `YYYY-MM-DD` | Datum bei `single` |
| `startDate`, `endDate` | `YYYY-MM-DD` | Zeitraum bei `range` (inklusive) |
| `yearly` | `true` / `false` | Jedes Jahr wiederholen (Jahreszahl wird ignoriert) |

## Wichtig bei Docker (z. B. Synology)

Das Plugin nutzt die Uhrzeit **und Zeitzone** des Servers. Läuft Homebridge im Container auf UTC, wechselt der Zustand erst um 01:00/02:00 Uhr deutscher Zeit. Setze daher im Container die Umgebungsvariable:

```
TZ=Europe/Berlin
```

Ob es passt, siehst du im Homebridge-Log: Beim Start wird für jedes Gerät gemeldet, ob es aktiv ist.

## Lizenz

MIT
