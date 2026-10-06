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
  sumWeeks: (list: string) => `Weeks: ${list}`,
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
    '**/ledger reset**: delete all entries (asks first)',
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
  sumWeeks: (list) => `Wochen: ${list}`,
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
    '**/ledger reset**: alle Einträge löschen (mit Rückfrage)',
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
}

export const T: Record<Lang, Texts> = { en, de }
