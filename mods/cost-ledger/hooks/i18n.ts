// cost-ledger: Texte und Formatierer für Englisch und Deutsch (release/I18N.md). Ohne `$`, ohne `Intl`: selbst formatiert.
// Sprache aus userConfig `language`; Standard Englisch.

export type Lang = 'en' | 'de'

export function langOf(v: unknown): Lang {
  return v === 'de' ? 'de' : 'en'
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** en `$1,234.50`, `< $0.01`, `$0.00`; de `1.234,50 $`, `< 0,01 $`, `0,00 $`. */
export function usd(v: number, lang: Lang): string {
  if (lang === 'de') {
    if (!(v > 0)) return '0,00 $'
    if (v < 0.005) return '< 0,01 $'
    return `${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.')} $`
  }
  if (!(v > 0)) return '$0.00'
  if (v < 0.005) return '< $0.01'
  return `$${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d)\.)/g, ',')}`
}

/** Tag `YYYY-MM-DD` kurz: en `Oct 6`, de `06.10.` */
export function shortDate(key: string, lang: Lang): string {
  const [, m = '1', d = '1'] = key.split('-')
  return lang === 'de' ? `${d}.${m}.` : `${MONTHS[Number(m) - 1]} ${Number(d)}`
}

/** Zeitpunkt mit Uhrzeit: en `Oct 6 14:05`, de `06.10. 14:05` */
export function dateTime(ms: number, lang: Lang): string {
  const d = new Date(ms)
  const day = lang === 'de' ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.` : `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Datum mit Jahr: en `Oct 6, 2026`, de `06.10.2026` */
export function fullDate(ms: number, lang: Lang): string {
  const d = new Date(ms)
  return lang === 'de' ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** Kalenderwoche: en `W41`, de `KW 41` */
export function weekLabel(week: number, lang: Lang): string {
  return lang === 'de' ? `KW ${week}` : `W${week}`
}

/** Tokens kurz: `412k`, en `1.2M`, de `1,2M` */
export function tokens(n: number, lang: Lang): string {
  const v = Math.max(0, Math.round(n || 0))
  const dec = (x: number) => (lang === 'de' ? x.toFixed(1).replace('.', ',') : x.toFixed(1))
  if (v >= 1e6) return `${dec(v / 1e6)}M`
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`
  if (v >= 1e3) return `${dec(v / 1e3)}k`
  return String(v)
}

const WEEKDAYS: Record<Lang, string[]> = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] }

/** Uhrzeit `HH:MM` (lokal) */
export function clock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Reset-Zeitpunkt: am selben Tag nur die Uhrzeit, sonst en `Mon Oct 12 04:00`, de `Mo 12.10. 04:00` */
export function resetTime(ms: number, now: number, lang: Lang): string {
  const d = new Date(ms)
  const n = new Date(now)
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock(ms)
  return `${WEEKDAYS[lang][d.getDay()]} ${dateTime(ms, lang)}`
}

/** Dauer, abgerundet: `3 h 50 min`, `12 min`, en `3 d 10 h`, de `3 T 10 h`; unter einer Minute `< 1 min` */
export function duration(ms: number, lang: Lang): string {
  const m = Math.floor(Math.max(0, ms) / 60000)
  if (m < 1) return '< 1 min'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d} ${lang === 'de' ? 'T' : 'd'} ${h} h`
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`
}

/** Auslastung ganzzahlig: `62 %` */
export function pct(v: number): string {
  return `${Math.round(v || 0)} %`
}

/** Faktor mit einer Stelle: en `4.1`, de `4,1` */
export function factor(v: number, lang: Lang): string {
  const s = (Number.isFinite(v) ? v : 0).toFixed(1)
  return lang === 'de' ? s.replace('.', ',') : s
}

/**
 * Fenster von–bis mit dem Datum des Beginns: de `08.10. 13–18`, en `Oct 8 16:10–21:10`; volle Stunden ohne Minuten,
 * ein Ende um Mitternacht als `24`.
 */
export function span(start: number, end: number, lang: Lang): string {
  const s = new Date(start)
  const e = new Date(end)
  const hours = s.getMinutes() === 0 && e.getMinutes() === 0
  const endH = e.getHours() === 0 && e.getMinutes() === 0 && e.getDate() !== s.getDate() ? 24 : e.getHours()
  const fmt = (h: number, m: number) => (hours ? pad(h) : `${pad(h)}:${pad(m)}`)
  const day = lang === 'de' ? `${pad(s.getDate())}.${pad(s.getMonth() + 1)}.` : `${MONTHS[s.getMonth()]} ${s.getDate()}`
  return `${day} ${fmt(s.getHours(), s.getMinutes())}–${fmt(endH, e.getMinutes())}`
}

/** Zeitraum in Tagen, 0 = alles: en `7 days`/`all time`, de `7 Tage`/`gesamt` */
export function rangeLabel(range: number, lang: Lang): string {
  if (range <= 0) return lang === 'de' ? 'gesamt' : 'all time'
  return lang === 'de' ? `${range} Tage` : `${range} days`
}

const en = {
  asOf: (t: string) => `as of ${t}`,
  since: (d: string) => `since ${d}`,
  reload: (cmd: string) => `reload: ${cmd}`,
  empty: 'No entries yet. Counting starts now, after every answer.',
  today: 'Today',
  days7: '7 days',
  days30: '30 days',
  allTime: 'All time',
  chats: (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'}`,
  last14Days: 'Last 14 days',
  last14Weeks: 'Last 14 weeks',
  highest: '← highest',
  noData: 'no data',
  modsPart: (model: string) => `${model} · mods`,
  modsNoData: 'mods, no data',
  unknownModel: 'Unknown',
  projectsIn: (range: string) => `Projects · ${range}`,
  chatsIn: (range: string) => `Most expensive chats · ${range}`,
  modelsIn: (range: string) => `Models · ${range}`,
  modsIn: (range: string) => `Mods · ${range}`,
  noCosts: 'no costs in this period',
  more: (n: number) => `+${n} more`,
  noModCalls: 'no model calls by other mods in this period',
  modsExtra: 'adds to the chat costs, not included in /cost',
  tokenLine: (i: string, o: string, cr: string, cw: string) => `Input ${i} · Output ${o} · Cache ${cr} read, ${cw} written`,
  noTokens: 'No answers with token data in this period yet.',
  modelsNote: 'Amount estimated from tokens × price table; includes model calls by other mods.',
  foot: 'API value; on a subscription it counts against your usage limits · /ledger weeks · chats · projects · models · help',
  noCost: 'This host reports no chat costs; only model calls by mods are recorded.',
  unreadable: (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'} unreadable.`,
  storeFull: (pct: number) => `Storage ${pct} % full (4 MiB): lower the retention (keepDays).`,
  writeFailed: (err: string) => `Saving failed last time: ${err}`,
  scriptRuns: 'Script runs',
  noFolder: '(no folder)',
  chatFrom: (t: string) => `Chat from ${t}`,
  sumTitle: (t: string, tag: string) => `**Cost ledger** · as of ${t} · ${tag}`,
  sumChats: (today: string, n: number, d7: string, d30: string, all: string) => `Chats: today ${today} (${n}) · 7 days ${d7} · 30 days ${d30} · all time ${all}`,
  sumMods: (today: string, d30: string, all: string) => `Mods: today ${today} · 30 days ${d30} · all time ${all}`,
  sumProjects: (list: string) => `Projects (30 days): ${list}`,
  sumTopChats: (list: string) => `Most expensive chats (30 days): ${list}`,
  sumModsList: (list: string) => `Mods (30 days): ${list}`,
  sumWeeks: (list: string) => `Weeks (chat + mods): ${list}`,
  sumChatsHead: (range: string, shown: number, total: number) => `Most expensive chats (${range}), ${shown} of ${total}:`,
  sumModelsHead: (range: string) => `Models (${range}), estimated API value from tokens, incl. mod calls:`,
  sumModelLine: (name: string, amt: string, pct: number, n: number, line: string) => `${name}: ${amt} (${pct} %) · ${n}× · ${line}`,
  sumMoreModels: (n: number) => `+${n} more models`,
  sumProjectsHead: (range: string) => `Projects (${range}):`,
  sumProjectRow: (name: string, amt: string, n: number) => `${name} ${amt} (${n} ${n === 1 ? 'chat' : 'chats'})`,
  sumFoot: 'Model calls by mods add to the chat costs (not included in /cost). API value; on a subscription it counts against your usage limits.',
  help: [
    '**/ledger**: overview (today, 7 and 30 days, all time, history, projects, most expensive chats, mods)',
    '**/ledger weeks**: the overview with the last 14 weeks instead of 14 days (`/ledger days` = default with days)',
    '**/ledger chats [7|30|all]**: the 20 most expensive chats (default 30 days)',
    '**/ledger projects [7|30|all]**: all projects in the period',
    '**/ledger models [7|30|all]**: models with share, input, output and cache tokens (default 30 days)',
    '**/ledger limits**: 5-hour and weekly window (% used, API value, reset, projection), subscription month, last 5-hour windows',
    '**/ledger plan <plan> <day|today> [price]**: set your plan and billing day, e.g. `/ledger plan max20 14` (`/ledger plan` shows the details)',
    '**/ledger reset**: delete all entries (asks first; the plan setting stays)',
    'Recorded after every answer: chat costs as in /cost, plus model calls by other mods. API value; on a subscription it counts against your usage limits.',
  ].join('\n'),
  unknownArg: (s: string) => `Unknown: “${s}”.`,
  askQuestion: 'Delete all entries in the cost ledger?',
  askCancel: 'Cancel (recommended)',
  askDelete: 'Delete',
  notDeletedNoAsk: 'Not deleted: the question cannot be asked here (e.g. in `-p`).',
  notDeleted: 'Not deleted.',
  cleared: (n: number) => `Cost ledger cleared (${n} ${n === 1 ? 'entry' : 'entries'}).`,
  commandDescription: 'Cost ledger: what chats, mods and models have cost',
  // Limits und Abo (0.5.0)
  limitsHead: 'cost-ledger · limits',
  fiveHours: '5 hours',
  week: 'Week',
  fiveShort: '5 h',
  weekShort: 'week',
  planShort: 'plan',
  resetAt: (when: string) => `reset ${when}`,
  inTime: (d: string) => `in ${d}`,
  projection: (amt: string) => `100 % ≈ ${amt} (estimate)`,
  projectionLater: 'projection from 5 %',
  projectionPartial: 'projection from the next window',
  projectionNone: 'no projection without a recorded amount',
  partialFrom: (t: string) => `from ${t}`,
  running: 'running',
  resetPassed: 'reset passed, no new answer yet',
  resetPassedShort: 'reset passed',
  noWindowYet: 'no reading yet',
  noLimitData: 'No limit data: no subscription detected, or no answer since the update yet.',
  subMonth: 'Subscription month',
  planNotSet: 'Plan not set: /ledger plan max20 14',
  planValue: (amt: string, price: string, f: string) => `${amt} API value for a ${price} plan = ${f}×`,
  planValueNoPrice: (amt: string) => `${amt} API value (no price set)`,
  listPrice: 'list price',
  renews: (d: string, n: number) => `renews ${d} (in ${n} ${n === 1 ? 'day' : 'days'})`,
  lastWindows: 'Last 5-hour windows',
  noWindows: 'No 5-hour window recorded yet.',
  avg: (amt: string, n: number) => `Ø 100 % ≈ ${amt} from ${n} ${n === 1 ? 'window' : 'windows'} (≥ 20 %, estimate)`,
  avgNone: 'Ø 100 %: no fully recorded, completed window with ≥ 20 % yet',
  limitsFoot: '% applies to the whole account (incl. claude.ai) · $ only from chats with cost-ledger · projections are estimates · /ledger plan',
  sumLimitsTitle: (t: string, tag: string) => `**Cost ledger · limits** · as of ${t} · ${tag}`,
  sumLimitsLine: (list: string) => `Limits: ${list} · /ledger limits`,
  sumLimitsFoot: '% applies to the whole account (incl. claude.ai); $ only counts chats with cost-ledger; projections are estimates.',
  perMonth: (price: string) => `${price}/month`,
  noPrice: 'no price',
  planSaved: (label: string, day: number, price: string, start: string, next: string) =>
    `Plan saved: ${label}, billing day ${day}, ${price}. Subscription month since ${start}, renews ${next} · details: /ledger limits`,
  planCurrent: (label: string, day: number, price: string, at: string) => `Plan: ${label}, billing day ${day}, ${price} (set ${at}).`,
  planNone: 'No plan set.',
  planDeleted: 'Plan setting deleted.',
  planInvalid: (s: string) => `Not saved: “${s}” is not valid.`,
  planHelp: [
    '**/ledger plan <plan> <day|today> [price]**: `pro`, `max5` (`5x`), `max20` (`20x`), `team` or `enterprise`; billing day 1–31 or `today`; monthly price in $, default list price (Pro $20, Max 5x $100, Max 20x $200).',
    'Examples: `/ledger plan max20 14` · `/ledger plan max20 today 180` · `/ledger plan off` deletes the setting. Claude Code does not tell mods your plan, so it is set here.',
  ].join('\n'),
}

export type Texts = typeof en

const de: Texts = {
  asOf: (t) => `Stand ${t}`,
  since: (d) => `seit ${d}`,
  reload: (cmd) => `neu laden: ${cmd}`,
  empty: 'Noch keine Einträge. Gezählt wird ab jetzt, nach jeder Antwort.',
  today: 'Heute',
  days7: '7 Tage',
  days30: '30 Tage',
  allTime: 'Gesamt',
  chats: (n) => `${n} ${n === 1 ? 'Chat' : 'Chats'}`,
  last14Days: 'Letzte 14 Tage',
  last14Weeks: 'Letzte 14 Wochen',
  highest: '← höchster',
  noData: 'ohne Angabe',
  modsPart: (model) => `${model} · Mods`,
  modsNoData: 'Mods ohne Angabe',
  unknownModel: 'Unbekannt',
  projectsIn: (range) => `Projekte · ${range}`,
  chatsIn: (range) => `Teuerste Chats · ${range}`,
  modelsIn: (range) => `Modelle · ${range}`,
  modsIn: (range) => `Mods · ${range}`,
  noCosts: 'keine Kosten im Zeitraum',
  more: (n) => `+${n} weitere`,
  noModCalls: 'keine Modellaufrufe anderer Mods im Zeitraum',
  modsExtra: 'kommt zu den Chat-Kosten hinzu, steckt nicht in /cost',
  tokenLine: (i, o, cr, cw) => `Input ${i} · Output ${o} · Cache ${cr} gelesen, ${cw} geschrieben`,
  noTokens: 'Noch keine Antworten mit Token-Angaben im Zeitraum.',
  modelsNote: 'Betrag geschätzt aus Tokens × Preistabelle; enthält die Modellaufrufe anderer Mods.',
  foot: 'API-Wert, im Abo zählt es aufs Kontingent · /ledger weeks · chats · projects · models · help',
  noCost: 'Dieser Host liefert keine Chat-Kosten; gebucht werden nur Mod-Aufrufe.',
  unreadable: (n) => `${n} ${n === 1 ? 'Eintrag' : 'Einträge'} unlesbar.`,
  storeFull: (pct) => `Speicher zu ${pct} % voll (4 MiB): Aufbewahrung (keepDays) senken.`,
  writeFailed: (err) => `Speichern scheiterte zuletzt: ${err}`,
  scriptRuns: 'Skript-Läufe',
  noFolder: '(ohne Ordner)',
  chatFrom: (t) => `Chat vom ${t}`,
  sumTitle: (t, tag) => `**Kostenbuch** · Stand ${t} · ${tag}`,
  sumChats: (today, n, d7, d30, all) => `Chats: heute ${today} (${n}) · 7 Tage ${d7} · 30 Tage ${d30} · gesamt ${all}`,
  sumMods: (today, d30, all) => `Mods: heute ${today} · 30 Tage ${d30} · gesamt ${all}`,
  sumProjects: (list) => `Projekte (30 Tage): ${list}`,
  sumTopChats: (list) => `Teuerste Chats (30 Tage): ${list}`,
  sumModsList: (list) => `Mods (30 Tage): ${list}`,
  sumWeeks: (list) => `Wochen (Chat + Mods): ${list}`,
  sumChatsHead: (range, shown, total) => `Teuerste Chats (${range}), ${shown} von ${total}:`,
  sumModelsHead: (range) => `Modelle (${range}), geschätzter API-Wert nach Tokens, inkl. Mod-Aufrufe:`,
  sumModelLine: (name, amt, pct, n, line) => `${name}: ${amt} (${pct} %) · ${n}× · ${line}`,
  sumMoreModels: (n) => `+${n} weitere Modelle`,
  sumProjectsHead: (range) => `Projekte (${range}):`,
  sumProjectRow: (name, amt, n) => `${name} ${amt} (${n} Chats)`,
  sumFoot: 'Mod-Aufrufe kommen zu den Chat-Kosten hinzu (sie stecken nicht in /cost). API-Wert; im Abo zählt es aufs Kontingent.',
  help: [
    '**/ledger**: Übersicht (heute, 7 und 30 Tage, gesamt, Verlauf, Projekte, teuerste Chats, Mods)',
    '**/ledger weeks**: Übersicht mit den letzten 14 Wochen statt 14 Tagen (`/ledger days` = Standard mit Tagen)',
    '**/ledger chats [7|30|all]**: die 20 teuersten Chats (Standard 30 Tage)',
    '**/ledger projects [7|30|all]**: alle Projekte im Zeitraum',
    '**/ledger models [7|30|all]**: Modelle mit Anteil, Input-, Output- und Cache-Tokens (Standard 30 Tage)',
    '**/ledger limits**: 5-Stunden- und Wochenfenster (% genutzt, API-Wert, Reset, Hochrechnung), Abo-Monat, letzte 5-Stunden-Fenster',
    '**/ledger plan <plan> <tag|heute> [preis]**: Abo und Abrechnungstag einstellen, z. B. `/ledger plan max20 14` (`/ledger plan` zeigt die Details)',
    '**/ledger reset**: alle Einträge löschen (mit Rückfrage; die Abo-Einstellung bleibt)',
    'Gezählt wird nach jeder Antwort: Chat-Kosten wie /cost, dazu die Modellaufrufe anderer Mods. API-Wert; im Abo zählt es aufs Kontingent.',
  ].join('\n'),
  unknownArg: (s) => `Unbekannt: „${s}“.`,
  askQuestion: 'Alle Einträge im Kostenbuch löschen?',
  askCancel: 'Abbrechen (empfohlen)',
  askDelete: 'Löschen',
  notDeletedNoAsk: 'Nicht gelöscht: Die Rückfrage ist hier nicht möglich (z. B. in `-p`).',
  notDeleted: 'Nicht gelöscht.',
  cleared: (n) => `Kostenbuch geleert (${n} ${n === 1 ? 'Eintrag' : 'Einträge'}).`,
  commandDescription: 'Kostenbuch: was Chats, Mods und Modelle gekostet haben',
  limitsHead: 'cost-ledger · Limits',
  fiveHours: '5 Stunden',
  week: 'Woche',
  fiveShort: '5 Std.',
  weekShort: 'Woche',
  planShort: 'Abo',
  resetAt: (when) => `Reset ${when}`,
  inTime: (d) => `in ${d}`,
  projection: (amt) => `100 % ≈ ${amt} (Schätzung)`,
  projectionLater: 'Hochrechnung ab 5 %',
  projectionPartial: 'Hochrechnung ab dem nächsten Fenster',
  projectionNone: 'keine Hochrechnung ohne gebuchten Betrag',
  partialFrom: (t) => `ab ${t}`,
  running: 'läuft',
  resetPassed: 'Reset vorbei, noch keine neue Antwort',
  resetPassedShort: 'Reset vorbei',
  noWindowYet: 'noch kein Messwert',
  noLimitData: 'Keine Limit-Daten: kein Abo erkannt oder seit dem Update noch keine Antwort.',
  subMonth: 'Abo-Monat',
  planNotSet: 'Abo nicht eingestellt: /ledger plan max20 14',
  planValue: (amt, price, f) => `${amt} API-Wert für ${price} Abo = ${f}×`,
  planValueNoPrice: (amt) => `${amt} API-Wert (kein Preis eingestellt)`,
  listPrice: 'Listenpreis',
  renews: (d, n) => `erneuert ${d} (in ${n} ${n === 1 ? 'Tag' : 'Tagen'})`,
  lastWindows: 'Letzte 5-Stunden-Fenster',
  noWindows: 'Noch kein 5-Stunden-Fenster erfasst.',
  avg: (amt, n) => `Ø 100 % ≈ ${amt} aus ${n} ${n === 1 ? 'Fenster' : 'Fenstern'} (≥ 20 %, Schätzung)`,
  avgNone: 'Ø 100 %: noch kein vollständig erfasstes, abgeschlossenes Fenster mit ≥ 20 %',
  limitsFoot: '% gilt fürs ganze Konto (auch claude.ai) · $ nur aus Chats mit cost-ledger · Hochrechnungen sind Schätzungen · /ledger plan',
  sumLimitsTitle: (t, tag) => `**Kostenbuch · Limits** · Stand ${t} · ${tag}`,
  sumLimitsLine: (list) => `Limits: ${list} · /ledger limits`,
  sumLimitsFoot: '% gilt fürs ganze Konto (auch claude.ai); $ zählt nur Chats mit cost-ledger; Hochrechnungen sind Schätzungen.',
  perMonth: (price) => `${price} im Monat`,
  noPrice: 'ohne Preis',
  planSaved: (label, day, price, start, next) =>
    `Abo gespeichert: ${label}, Abrechnungstag ${day}, ${price}. Abo-Monat seit ${start}, erneuert ${next} · Details: /ledger limits`,
  planCurrent: (label, day, price, at) => `Abo: ${label}, Abrechnungstag ${day}, ${price} (eingestellt ${at}).`,
  planNone: 'Kein Abo eingestellt.',
  planDeleted: 'Abo-Einstellung gelöscht.',
  planInvalid: (s) => `Nicht gespeichert: „${s}“ ist ungültig.`,
  planHelp: [
    '**/ledger plan <plan> <tag|heute> [preis]**: `pro`, `max5` (`5x`), `max20` (`20x`), `team` oder `enterprise`; Abrechnungstag 1–31 oder `heute`; Monatspreis in $, Standard ist der Listenpreis (Pro 20 $, Max 5x 100 $, Max 20x 200 $).',
    'Beispiele: `/ledger plan max20 14` · `/ledger plan max20 heute 180` · `/ledger plan off` löscht die Einstellung. Claude Code verrät Mods den Plan nicht, deshalb wird er hier eingestellt.',
  ].join('\n'),
}

export const T: Record<Lang, Texts> = { en, de }
