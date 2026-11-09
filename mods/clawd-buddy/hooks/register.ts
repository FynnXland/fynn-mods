// clawd-buddy: Hooks-Modul. Beobachtet nur: jeder Event-Hook gibt per `next(e)` unverändert weiter, nichts wird blockiert oder verändert.
// Ausnahme seit 0.7.0: Der CommandOutput-Hook zeichnet die eigene Ausgabe von `/clawd help` als Tabelle (docs/HELP-SPEC.md).
//
// Aufgabe: aus Events *Fakten* sammeln (wann begann der Turn, welches Tool läuft seit wann, ob eine Frage offen ist, wann zuletzt
// getippt wurde, wie der letzte Turn endete) und sie als `props` an das Client-Modul `./buddy.ts` reichen. Die Stimmung leitet der Client
// daraus auf seiner eigenen Uhr ab (mood.ts); `$.ui.invalidate` läuft darum nur bei echten Ereignissen, nie im Bildtakt (Desktop: desk.ts).
// Zeichnet ins Band über dem Prompt (docs/raw/en/interface.md:207-213) und lässt fremden Inhalt stehen (`await next(e)` als Kind).
import type { EngineInterface, On, Timer } from 'claude-code'
import { joinBand, nameOf, slot, SLOTS, splitBand } from './band.ts'
import { ALL_CLIPS } from './library.ts'
import { AWAY_MS, NO_FACTS, NO_STRAIN, SETBACK, STREAK_STEP, TYPING_MS, addHit, ctxLevel, deriveTemper, beatValue, musicValue, shellKind, sidekickValue, strainTurnEnd, strainTurnStart, toolKind } from './mood.ts'
import { FROST_BREAK_P, FROST_BURST_MS, FROST_ESTIMATE_MS, FROST_GRACE_MS, frostDecide, frostRoll, sidekickStatus } from './mood.ts'
import type { FrostSource, Strain } from './mood.ts'
import { createDesk, DESK_TICK, stillSource } from './desk.ts'
import { T, clipLabel, langOf, num as fmt } from './i18n.ts'
import { ACCENT, SUBCOMMANDS, clawdHelp, isHelp } from './clawdhelp.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import type { Lang } from './i18n.ts'
import { isLanguage, languageCommand } from './language.ts'
import { migrateSettings, readSettings, writeNote, writeSettings } from './settings.ts'
import { storeOffDefaults } from './offdefaults.ts'
import { SETTINGS } from './fields.ts'
import { H, W } from './stage.ts'
import type { Desk } from './desk.ts'
import type { Facts, ToolKind } from './mood.ts'

// `enabledMigrated`: der Wert von `enabled`, der zuletzt nach userConfig umgezogen ist (0.14.2)
type Stored = { enabled?: boolean; enabledMigrated?: boolean; annoy?: number; seenAt?: number }

// /clawd help (docs/HELP-SPEC.md §3): Schnappschuss beim Aufruf unter einer Kennung `#…`; der CommandOutput-Hook zeichnet ihn.
// Höchstens 10 Einträge, der älteste fällt heraus. Status = Stand beim Aufruf, die Zeichnung schreibt sich nicht um.
const helps = new Map<string, HelpData>()
let helpNo = 0

// Flüchtiger Zustand dieses Moduls (wird aus Events neu abgeleitet; Reload setzt zurück)
let enabled = true
// Einstellung „Ice when the cache is cold“ (0.14.0, userConfig iceWhenCold)
let iceWhenCold = true
// Wert der Einstellung `enabled` für die Hilfe: demo/nap/freeze zeigen Clawd nur für die Sitzung (Review 0.14.0 K3)
let enabledSetting = true
// Breite des Platzes im Desktop für tune-strip: `$.state` `clawd-buddy.band` (types/index.d.ts, docs/BAND.md „Platzbreite“). `undefined` =
// noch nicht geschrieben; nie im Zeichnen, dort darf `$.state` nicht geschrieben werden.
let isDesktop = false
let publishedWidth: number | null | undefined = undefined
let publishChain: Promise<unknown> = Promise.resolve()
let sessionStarted = false // erst nach session.start kennt der Mod die Oberfläche (isDesktop)
function publishBand($: EngineInterface) {
  const width = enabled && isDesktop ? DESK_WIDTH : null
  if (width === publishedWidth) return
  publishedWidth = width
  // Schreibvorgänge nacheinander; Beiwerk: ein Fehler ändert nichts an Clawd
  publishChain = publishChain.then(() => $.state.set({ plugin: 'clawd-buddy', key: 'band' }, width === null ? null : { width })).catch(() => {})
}
let annoy = 0
let napN = 0
let boopN = 0
let demo = ''
let demoN = 0
const seed = 20260
const running = new Map<string, { kind: ToolKind; since: number }>()
let facts: Facts = { ...NO_FACTS }
let strain: Strain = { ...NO_STRAIN } // Laune: Rückschläge, Erfolge, Arbeitszeit am Stück (mood.ts)
let turnHadError = false
const agentSeen = new Map<string, number>() // laufende Subagenten: agentId → letzte Aktivität (ms)
let askTool = ''
let ctxWarned = 0 // zuletzt gemeldete Stufe des Kontextfensters (mood.ts → CTX_WARN)
let ctxPending = false // neue Stufe erreicht, wird am Turn-Ende gezeigt
let typingPerf = 0 // performance.now() des letzten Tastendrucks (synchron lesbar, ohne `$`-Aufruf pro Taste)
let typingInvalidatedPerf = -1e9
// Rückkehr nach langer Pause (Begrüßung): letzte Anwesenheit (ms, auch über Sitzungen hinweg gespeichert) und Drosseln
let lastSeen = 0
let seenSaved = 0
let seenPerf = -1e9

// ---- Eisklumpen (0.13.0, SPEC „Ausbau 0.13.0“ Teil A). Nur im Speicher: ein Neuladen des Mods darf neu würfeln (README: Grenze).
let chatFrozen = false // in diesem Chat schon gefroren (höchstens einmal pro Chat; /clawd freeze zählt nicht)
let skUsable = false // sidekick.status brauchbar (vorhanden, gültig, nicht `off`): dann keine eigene Schätzung
let skCold = false // zuletzt gelesenes sidekick.status.cold (nur der Wechsel auf true beginnt einen kalten Moment)
// Für /clawd status: letzter kalter Moment, ob gewürfelt wurde, Ergebnis
let frostInfo: { src: '' | FrostSource; rolled: boolean; result: '' | 'frozen' | 'no' | 'music' | 'already' | 'turn' | 'warm' | 'off' } = { src: '', rolled: false, result: '' }
// Uhrzeit zu performance.now() (aus der letzten Zeichnung): so braucht das Tippen keinen `$`-Aufruf je Taste, um die Zeit zu kennen
let clockAt: { clock: number; perf: number } | null = null
// 0.13.1: resume/fork hat über den Chat schon entschieden (Cache-Stand bekannt). Ein späteres session.start setzt dann nichts zurück und
// würfelt nicht; ob classic.SessionStart bei --resume vor oder nach session.start kommt, ist nicht dokumentiert [UNKLAR].
let resumeDecided = false

/** Neuer Chat (Start, /clear): Eis und „einmal pro Chat“ zurücksetzen. */
function newChat() {
  chatFrozen = false
  skCold = false
  if (facts.frost) {
    facts = { ...facts }
    delete facts.frost
  }
}

/** Ein begonnenes Eis (nicht /clawd freeze) zählt für „einmal pro Chat“. */
function noteFrozen(now: number) {
  if (facts.frost && facts.frost.src !== 'manual' && now >= facts.frost.at) chatFrozen = true
}

/**
 * Ein kalter Moment beginnt (SPEC Teil A): einmal würfeln (p = 1/3), höchstens einmal pro Chat, nie im Turn, kein neues Einfrieren bei
 * Musik. Bei der eigenen Schätzung liegt der Beginn in der Zukunft (`at`); gewürfelt wird schon jetzt, der Client sieht selbst, wann es so
 * weit ist (kein Takt im Hooks-Modul nötig). Der Würfel hängt an der Uhrzeit (frostRoll): mit fester Uhr wiederholbar.
 */
function coldMoment(src: FrostSource, now: number, at = now): boolean {
  // Einstellung „Ice when the cache is cold“ aus (0.14.0): kein Einfrieren, auch kein Würfeln
  if (!iceWhenCold) {
    frostInfo = { src, rolled: false, result: 'off' }
    return false
  }
  noteFrozen(now)
  const frozenNow = !!facts.frost && facts.frost.sentAt === undefined && now >= facts.frost.at
  const result = frostDecide({ turnActive: facts.turnActive, chatFrozen, frozenNow, music: !!facts.music }, frostRoll(at))
  frostInfo = { src, rolled: result === 'frozen' || result === 'no', result }
  if (result !== 'frozen') {
    // Eine noch geplante ältere Schätzung gilt nicht mehr (dieser Moment ersetzt sie)
    if (result === 'no' && facts.frost && facts.frost.sentAt === undefined && now < facts.frost.at) {
      facts = { ...facts }
      delete facts.frost
    }
    return false
  }
  facts = { ...facts, frost: { at, src, cracks: 0 } }
  noteFrozen(now)
  return true
}

/**
 * Gesendet (das erste von turn.start und sidekick check/stop): das Eis zerbricht (3 von 4) oder schmilzt. Noch nicht begonnen (Schätzung)
 * heißt: der kalte Moment kommt nicht. Ganz kurz nach dem Beginn entfällt das Eis (es hatte sich kaum gebildet). Liefert, ob sich etwas änderte.
 */
function frostSent(now: number): boolean {
  const fr = facts.frost
  if (!fr || fr.sentAt !== undefined) return false
  facts = { ...facts }
  if (now < fr.at) {
    delete facts.frost
    return true
  }
  noteFrozen(now)
  if (now - fr.at < FROST_GRACE_MS) {
    delete facts.frost
    return true
  }
  facts.frost = { ...fr, sentAt: now, how: frostRoll(fr.at + 1) < FROST_BREAK_P ? 'break' : 'melt', level: fr.cracks }
  return true
}

// Desktop-App: Dort lädt der Client-Rahmen nicht; die Engine läuft im Hooks-Modul (desk.ts). Jede Zeichnung liefert die nächsten
// Sekunden als ein Svg mit SMIL-Animation, das der Desktop selbst abspielt. Neu gezeichnet wird nur bei Ereignissen und kurz bevor die
// Animation endet (Fynn, 2026-10-06: Jede Neuzeichnung des Bands lässt den Desktop auch die von sidekick gehookten eigenen Nachrichten
// neu anfordern; bei ~5 Bildwechseln/s flackerten deren Hover-Leiste und Hinterlegung. Vorher, 2026-10-05: 13/s ließen Knöpfe im Band flackern.)
// Der Wächter (`$.clock.every`, liefert einen Timer mit `cancel()`, types:12280) läuft nur, solange die Desktop-App das Band zeichnet und
// der Buddy an ist: `/clawd off` bricht ihn ab, und zeichnet die App auf die Bitte hin 2 s lang nicht, bricht er sich selbst ab; das
// nächste Zeichnen startet ihn neu. Gezählt wird in Wächter-Runden, nicht in Echtzeit (im Test-Kit läuft nur die Uhr der Mods-API).
const DESK_SCALE = 4 // CSS-Pixel je Figurpixel: Figur 68 × 40 px, Bühne 400 × 56 px
const DESK_WIDTH = W * DESK_SCALE // Breite des Platzes im Desktop, wie sie an tune-strip gemeldet wird
const BACK_SLOT = 0 // 0.12.1: Platz der Bühne hinter der Zeile, vor allen anderen Plätzen (docs/BAND.md)
// Durchsichtiger Halter für die Höhe der Bühne (Platz 30), 1 × 56 px
const ROOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 ${H * DESK_SCALE}" width="1" height="${H * DESK_SCALE}"></svg>`
const DESK_CHECK = 250 // ms je Wächter-Runde
const DESK_LEAD = 1000 // so lange vor dem Ende der Animation um die nächste bitten
const DESK_IDLE_CHECKS = 8 // ~2 s ohne Antwort auf die Bitte: Wächter beenden
let desk: Desk | null = null
let deskTimer: Timer | null = null
let deskChecks = 0 // Wächter-Runden seit der letzten Zeichnung
let deskPlanMs = 0 // Länge der zuletzt gezeichneten Animation
let deskAsked = 0 // Wächter-Runden, seit um eine neue Zeichnung gebeten wurde (0 = keine Bitte offen)
// Eine abgelehnte Periode beendet `$.clock.every` still (types:3390-3391), `deskTimer` bliebe dann gesetzt und der Wächter käme nie
// wieder. Darum zählt jede Runde `deskBeats`; sieht ein Zeichnen DESK_IDLE_CHECKS Runden lang (~2 s Uhrzeit) keine neue, startet es ihn neu
// (wie limit-bars). Verglichen wird von Zeichnen zu Zeichnen, nicht gegen eine Sollzahl: Runden laufen nacheinander und hinken der Uhr nach.
let deskBeats = 0
let deskBeatsSeen = 0 // Stand von deskBeats beim letzten Zeichnen, das eine neue Runde sah
let deskBeatsSeenAt = 0 // Uhrzeit dieses Zeichnens
// Flackern (Fynn, 2026-10-06: „Es darf nicht flackern“): Ein neues `source` lud bis 0.6.5 den Rahmen neu, die Figur blinkte dabei kurz.
// Das Band wird auch für andere Mods neu gezeichnet (limit-bars, sidekick, quick-replies); Ereignisse, die an der laufenden Animation
// nichts ändern, bitten seit 0.6.9 gar nicht erst darum (factsChanged); Clawd selbst bittet erst kurz bevor die neuen Fakten etwas anderes
// zeigen (desk.divergence) oder die Animation endet. Zeichnet die App trotzdem (für einen anderen Mod), rechnet Clawd ab dem gezeigten Bild neu
// (0.8.1, „Springen“ unten). Eingriffe (`/clawd demo|nap|boop|on`) erzwingen eine neue Zeichnung.
// Bild statt Rahmen (0.6.6): Bis 0.6.5 lief das Svg mit `isInteractive` in einem Rahmen, der bei jedem neuen `source` neu lud und dabei kurz
// leer war. `/clawd flicker` zeigte (Fynn, 2026-10-07: blinkt in allen drei Abschnitten), dass die App beim Wechsel auch einen unveränderten
// Rahmen neu lädt; die Staffelübergabe mit zwei Rahmen (0.6.3) war wirkungslos. Jetzt ein einziges Svg als Bild (ohne `isInteractive`,
// types:11956-11957): Beim Tausch bleibt das alte Bild stehen, bis das neue fertig ist; SMIL läuft auch im Bild (Abnahme 2026-10-07, desk.ts).
let deskSvg = '' // zuletzt gezeichnetes Svg
let deskDrawnAt = 0 // Uhrzeit der letzten echten Zeichnung
let deskForce = false // Eingriff: sofort neu
let deskFresh = false // Sitzung wieder angezeigt oder eingeschaltet: sofort neu (eigene Zählung in `/clawd status`)
// Flacker-Test (`/clawd flicker`): Beginn (Uhrzeit), -2 = beginnt beim nächsten Zeichnen, -1 = aus. Zwei Abschnitte je 10 s, alle 2 s ein
// neues `source` mit gleichem Bild; der Wächter bittet alle 0,5 s ums Zeichnen. 1 = als Bild (wie im Betrieb seit 0.6.6), 2 = im Rahmen
// (`isInteractive`, wie bis 0.6.5) zum Vergleich. Ein Punkt neben der Nummer blinkt per SMIL: In 1 muss er blinken (SMIL läuft im Bild),
// Clawd selbst darf es nicht.
const DIAG_MS = 20_000
const DIAG_STEP = 2000
let deskDiag = -1
let deskDiagRounds = 0 // Wächter-Runden im Test; zeichnet die App nicht mehr (verdeckt), endet er danach von selbst
// Springen (Fynn, 2026-10-06 und 2026-11-03: „springt immer wieder ein Stück zurück und wiederholt seine Animation“): Zeichnet die App das Band
// neu, beginnt SMIL im Bild wieder bei 0, auch bei byte-gleichem `source` (Messung 0.8.1, SPEC). Bis 0.8.0 ging bei einer Zeichnung ohne neue
// Fakten dasselbe Svg bis 5 s lang wieder hinaus; Clawd fiel damit bei jeder fremden Zeichnung an den Anfang dieses Svg zurück. Seit tune-strip
// beim Abspielen jede Sekunde neu zeichnen lässt, geschah das ständig. Jetzt rechnet jede Zeichnung ab dem Bild, das gerade zu sehen ist,
// neu (~5 ms); ein Neustart zeigt so genau das Bild, das ohnehin dran war. Der Rest unter einem Takt geht als SMIL-`begin` mit (desk.ts).
// Ob eine Zeichnung neue Fakten zeigen muss (factsChanged, divergence), entscheidet weiter, ob Clawd selbst um eine Zeichnung bittet.
let deskShape = ''
// Messung für `/clawd status` (Fynn, 2026-10-05: Clawd wirkt bei mehreren Agenten verzögert). Zählt seit dem letzten `/clawd status`,
// mit performance.now() (synchron, kein `$`-Aufruf): Zeichnungen, Länge und Bildwechsel der Animationen, Rechen- und Zeichendauer.
// Dazu (0.6.5): wie oft wegen eines geänderten Aufbaus des Bands bzw. nach Wiederanzeigen oder Einschalten neu gezeichnet wurde.
type DeskMeter = {
  since: number; draws: number; foreign: number; planSecs: number; changes: number; chars: number; calcSum: number; calcMax: number; drawSum: number; drawMax: number; othersSum: number
  freshShape: number; freshShown: number; skipped: number
}
const newMeter = (): DeskMeter => ({
  since: performance.now(), draws: 0, foreign: 0, planSecs: 0, changes: 0, chars: 0, calcSum: 0, calcMax: 0, drawSum: 0, drawMax: 0, othersSum: 0,
  freshShape: 0, freshShown: 0, skipped: 0,
})
let meter = newMeter()
function meterText(lang: Lang, m: DeskMeter, at: number): string {
  const s = (at - m.since) / 1000
  if (m.draws === 0) return T[lang].deskNone
  const avg = (sum: number) => fmt(lang, m.draws ? sum / m.draws : 0)
  const avgAll = (sum: number) => fmt(lang, sum / m.draws)
  return T[lang].desk({
    secs: s.toFixed(0), draws: m.draws, foreign: m.foreign, perMin: fmt(lang, s > 0 ? (m.draws * 60) / s : 0), planSecs: avg(m.planSecs), changes: avg(m.changes),
    kb: fmt(lang, m.draws ? m.chars / m.draws / 1000 : 0), calcAvg: avg(m.calcSum), calcMax: fmt(lang, m.calcMax), drawAvg: avgAll(m.drawSum),
    drawMax: fmt(lang, m.drawMax), others: avgAll(m.othersSum),
  }) + T[lang].deskFresh({ shape: m.freshShape, shown: m.freshShown, skipped: m.skipped })
}

/** Fakten für die Desktop-Engine zur Uhrzeit `now`: wie gespeichert, dazu der letzte Tastendruck auf diese Uhr umgerechnet. */
function deskFacts(now: number): Facts {
  const f: Facts = { ...facts }
  if (typingPerf > 0) f.typingAt = now - (performance.now() - typingPerf)
  return f
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function latestTool(): Facts['tool'] {
  let best: { kind: ToolKind; since: number } | null = null
  for (const t of running.values()) if (!best || t.since >= best.since) best = t
  return best
}

/**
 * Neue Fakten: um eine Neuzeichnung bitten. Im Desktop nur, wenn die gezeigte Animation sie vor ihrem Ende anders zeigen müsste
 * (desk.divergence, wie beim Zeichnen); sonst rückt nur die Bitte des Wächters vor. Grund (Fynn, 2026-10-07): Jede Neuzeichnung des Bands
 * lässt die Desktop-App auch die Zeilen neu anfordern, die sidekick an deinen Nachrichten hookt, und deren Hover-Leiste flackert (SPEC 0.4.2).
 * Bis 0.6.8 zeichnete jedes Ereignis neu, auch wenn das Svg gleich blieb; bei viel Arbeit (mehrere Agenten) flackerte es so immer öfter.
 * Ohne Uhrzeit (`now` fehlt, oder eine Ersatzzeit vor der letzten Zeichnung) oder im Terminal wie bisher: divergence liefe sonst von dieser
 * Zeit an Takt für Takt bis zum Ende der Animation, bei 0 praktisch endlos (Review 0.6.9, S1).
 */
function factsChanged($: EngineInterface, now?: number) {
  if (now !== undefined && now >= deskDrawnAt && desk && deskTimer && deskSvg !== '' && !deskForce && !deskFresh && deskAsked === 0 && deskDiag === -1) {
    const div = desk.divergence(now, deskFacts(now), strain)
    const left = desk.remaining(now)
    if (div > DESK_LEAD && left > DESK_LEAD) {
      deskPlanMs = Math.min(deskPlanMs, now - deskDrawnAt + Math.min(div, left))
      meter.skipped += 1
      return
    }
  }
  $.ui.invalidate('ui.render')
}

/**
 * Läuft schon Musik? Vor dem Würfeln beim Start lesen (beim Start ist facts.music noch leer, es kommt sonst erst mit der ersten Zeichnung):
 * kein neues Einfrieren bei Musik (SPEC Teil A, Review S2). Lesen geht auch außerhalb des Zeichnens (types:3526-3546).
 */
async function readMusic($: EngineInterface) {
  try {
    const sp = await $.state.get({ plugin: 'tune-strip', key: 'playing' })
    facts = { ...facts, music: musicValue(sp.value) }
  } catch (err) {
    $.ui.log(`clawd-buddy: tune-strip state not read: ${String(err)}`, { to: 'debug' })
  }
}

// Top-Level-Funktion: `$` darf nur an solche weitergereicht werden (docs/raw/en/create.md:317)
async function save($: EngineInterface) {
  const prev = ((await $.store.get('buddy')) ?? {}) as Stored
  // `enabled` bleibt stehen, bis der Umzug (migrate) es nach userConfig gebracht hat (Review 0.14.0 S1)
  await $.store.set('buddy', { ...prev, annoy })
}

/**
 * Einmal je Start (0.14.0, docs/SETTINGS-SPEC.md §4): `enabled` stand bis 0.13.1 im Store `buddy` und galt dort. Ein abweichender Wert
 * wird nach userConfig geschrieben, danach in `buddy` als `enabledMigrated` vermerkt (Laune und „zuletzt gesehen“ bleiben). Im Hintergrund.
 */
async function migrate($: EngineInterface, lang: Lang) {
  let prev: Stored
  try {
    prev = ((await $.store.get('buddy')) ?? {}) as Stored
  } catch {
    return
  }
  // Schon umgezogen: `enabledMigrated` hält den umgezogenen Wert. Schaltet ein Chat, der nach dem Update noch mit 0.13.x läuft,
  // `enabled` um, weicht er ab und zieht beim nächsten Start um (0.13.x schreibt `buddy` mit allen Feldern weiter).
  if (typeof prev.enabled !== 'boolean' || prev.enabledMigrated === prev.enabled) return
  // Markieren statt das Feld zu löschen (0.14.2, wie sidekick 0.23.0 Review S1): Ein Chat mit 0.13.x liest `enabled` bis
  // `/reload-plugins` weiter; gelöscht zeigte er Clawd wieder, auch wenn er aus war.
  const moved = prev.enabled
  const clear = async () => {
    const now = ((await $.store.get('buddy')) ?? {}) as Stored
    await $.store.set('buddy', { ...now, enabledMigrated: moved })
  }
  const { apply } = await migrateSettings($, 'clawd-buddy', SETTINGS, { enabled }, { enabled: prev.enabled }, clear, lang)
  if (typeof apply.enabled === 'boolean' && apply.enabled !== enabled) {
    enabled = apply.enabled
    enabledSetting = apply.enabled
    deskForce = true
    publishBand($)
    $.ui.invalidate('ui.render')
  }
}

/**
 * Fynn ist da (tippt bzw. die Desktop-Sitzung wird wieder angezeigt). War er länger als AWAY_MS weg, begrüßt Clawd ihn mit einer
 * Aufsteh-Animation (`facts.backAt`). Gespeichert wird nur der Zeitpunkt, höchstens alle 5 Minuten.
 */
async function noteSeen($: EngineInterface, now: number) {
  if (lastSeen > 0 && now - lastSeen >= AWAY_MS) {
    facts = { ...facts, backAt: now }
    factsChanged($, now)
  }
  lastSeen = Math.max(lastSeen, now)
  if (now - seenSaved < 300_000) return
  seenSaved = now
  const prev = ((await $.store.get('buddy')) ?? {}) as Stored
  await $.store.set('buddy', { ...prev, seenAt: now })
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  // Einstellungen (0.14.0, docs/SETTINGS-SPEC.md §4): einzige Quelle ist userConfig. /clawd on|off schreibt `enabled` über hooks/settings.ts.
  const cfg = readSettings(SETTINGS, options)
  const nightStart = num(cfg.nightStart, 23)
  const nightEnd = num(cfg.nightEnd, 6)
  const idleSeconds = num(cfg.idleSeconds, 45)
  const reduced = cfg.reducedMotion === true
  const flip = cfg.side === 'left'
  const birthday = typeof cfg.birthday === 'string' ? cfg.birthday : ''
  enabled = cfg.enabled !== false
  enabledSetting = enabled
  iceWhenCold = cfg.iceWhenCold !== false
  const lang = langOf(options.language)
  const tx = T[lang]

  // /clear, /resume und /branch setzen $.state zurück, ohne dass session.start erneut feuert (docs/raw/en/troubleshoot.md:260-264):
  // die Platzbreite für tune-strip sofort wieder melden (docs/raw/en/interface.md:818-846; Review 0.8.1 S1, Fynn 2026-11-03)
  // Bei --resume ist die Reihenfolge zu session.start nicht dokumentiert [UNKLAR]: vorher nichts schreiben (isDesktop stünde noch auf false);
  // geschrieben wird in derselben Kette wie sonst, also in Aufrufreihenfolge (Review 0.9.1 K4)
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    if (sessionStarted) {
      publishedWidth = undefined
      publishBand($)
    }
    // /clear ist ein neuer Chat (0.13.0): kalter Moment, „einmal pro Chat“ beginnt neu.
    if (e.source === 'clear') {
      newChat()
      try {
        const now = await $.clock.now()
        if (coldMoment('new', now)) factsChanged($, now)
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
    }
    // resume/fork (0.13.1, Nachtrag): ein anderer Chat. Abgelaufener Cache (types 2.1.318:12596-12598) ist ein kalter Moment mit dem
    // normalen Würfel, warmer Cache keiner (ein Wurf aus session.start entfällt dann). Fehlt das Feld (z. B. noch keine Antwort im Verlauf,
    // rel/hooks.md:1275), bleibt alles wie in 0.13.0.
    const expired = e.prompt_cache_likely_expired
    if ((e.source === 'resume' || e.source === 'fork') && typeof expired === 'boolean') {
      resumeDecided = true
      newChat()
      if (expired) {
        await readMusic($)
        let now: number | undefined
        try {
          now = await $.clock.now()
        } catch (err) {
          $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
        }
        if (now !== undefined) coldMoment('resume', now)
        else frostInfo = { src: 'resume', rolled: false, result: '' }
        factsChanged($, now)
      } else {
        frostInfo = { src: 'resume', rolled: false, result: 'warm' }
        factsChanged($)
      }
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    isDesktop = e.surface === 'desktop'
    publishedWidth = undefined
    sessionStarted = true
    try {
      const s = ((await $.store.get('buddy')) ?? {}) as Stored
      annoy = num(s.annoy, 0)
      // Zuletzt gesehen (auch in einer anderen Sitzung): eine neue Sitzung am nächsten Morgen begrüßt dich so ebenfalls
      if (!lastSeen) lastSeen = num(s.seenAt, 0)
    } catch (err) {
      $.ui.log(`clawd-buddy: store not read: ${String(err)}`, { to: 'debug' })
    }
    publishBand($)
    // Danach (nicht gleichzeitig, beide schreiben settings.json) die Aus-Standards einmal speichern (hooks/offdefaults.ts)
    void migrate($, lang).catch(() => {}).then(() => storeOffDefaults($, 'clawd-buddy', SETTINGS))
    // Neuer Chat (0.13.0): ein kalter Moment. Hat resume/fork schon entschieden (0.13.1, kam vor session.start), bleibt es dabei.
    await readMusic($)
    if (!resumeDecided) {
      newChat()
      try {
        const now = await $.clock.now()
        // Kam resume/fork während des Wartens auf die Uhr (Zustellung nebeneinander ist nicht dokumentiert, Review 0.13.1 K1): nicht würfeln
        if (!resumeDecided) coldMoment('new', now)
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
    }
    try {
      await $.command.register({ name: 'clawd', description: tx.description, argumentHint: 'on | off | list | demo <animation> | nap | boop | freeze | status | flicker | language | help' })
    } catch (err) {
      $.ui.log(`/clawd not registered: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  // ---- Nutzungslimits (nur Prozent und Reset-Zeit, types:10566): ausgeschöpftes Limit → eigene Animationen
  on('session.measure', async ($, e, next) => {
    try {
      const pick = (kind: string) => e.rateLimits.find((r) => r.kind === kind)
      const five = pick('five_hour')
      const week = pick('seven_day')
      const ms = (iso?: string) => (iso ? Date.parse(iso) || undefined : undefined)
      const limits = { five: five?.percentUsed, fiveReset: ms(five?.resetsAt), week: week?.percentUsed, weekReset: ms(week?.resetsAt) }
      if (JSON.stringify(limits) !== JSON.stringify(facts.limits ?? {})) {
        facts = { ...facts, limits }
        factsChanged($, await $.clock.now().catch(() => undefined))
      }
    } catch (err) {
      $.ui.log(`clawd-buddy: limits not read: ${String(err)}`, { to: 'debug' })
    }
    // Kontextfenster: nur die Prozentzahl (types:10771). Eine neue Stufe zeigt er am Turn-Ende; fällt sie (Komprimieren), ist sie wieder scharf.
    try {
      const pct = e.context?.percent
      if (typeof pct === 'number' && Number.isFinite(pct)) {
        const lvl = ctxLevel(pct)
        if (lvl > ctxWarned) ctxPending = true
        // Wieder gefallen (im Turn komprimiert): die vorgemerkte Warnung gilt nicht mehr (Review 0.8.1)
        else if (lvl < ctxWarned) ctxPending = false
        ctxWarned = lvl
        if (ctxPending && !facts.turnActive) {
          const at = await $.clock.now()
          ctxPending = false // erst nach dem Lesen der Uhr: wirft sie, bleibt die Warnung für das Turn-Ende stehen
          facts = { ...facts, ctxAt: at }
          factsChanged($, at)
        }
      }
    } catch (err) {
      $.ui.log(`clawd-buddy: context not read: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  // ---- Fakten aus den Events
  on('turn.start', async ($, e, next) => {
    facts = { ...facts, turnActive: true, endedKind: '', lastTool: undefined }
    let now: number | undefined
    try {
      now = await $.clock.now()
      // Eis (0.13.0): Senden taut ihn auf, vor der Arbeit
      frostSent(now)
      if (!strain.turnSince) strain = strainTurnStart(strain, now)
      turnHadError = false
    } catch {
      // Laune ist Beiwerk: ohne Uhr bleibt sie, wie sie ist
    }
    factsChanged($, now)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Ein Subagent-Lauf trägt `agentId`: dann ist dieser Subagent fertig (zählt nicht mehr), die Hauptstimmung bleibt
    if (e.agentId) {
      if (agentSeen.delete(e.agentId)) {
        let doneAt = facts.agentDoneAt ?? 0
        let clock = false
        try {
          doneAt = await $.clock.now()
          clock = true
        } catch (err) {
          $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
        }
        facts = { ...facts, agents: [...agentSeen.values()], agentDoneAt: doneAt }
        factsChanged($, clock ? doneAt : undefined)
      }
    } else {
      // Wirft die Uhr, bleibt der Turn trotzdem nicht "aktiv" hängen (letzte bekannte Zeit als Ersatz)
      let now = facts.endedAt
      let clockOk = false
      try {
        now = await $.clock.now()
        clockOk = true
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      running.clear()
      askTool = ''
      const turnMs = strain.turnSince ? Math.max(0, now - strain.turnSince) : 0
      facts = { ...facts, turnActive: false, tool: null, ask: false, endedAt: now, endedKind: e.reason === 'answer' ? 'done' : 'oops', turnMs }
      if (ctxPending) {
        ctxPending = false
        facts = { ...facts, ctxAt: now }
      }
      strain = strainTurnEnd(strain, now, e.reason === 'answer', !turnHadError)
      // Eis (0.13.0): ohne brauchbaren sidekick-Wert schätzt Clawd selbst: 60 min nach diesem Turn gilt der Cache als kalt.
      // Nur mit gelesener Uhr: die Ersatzzeit kann 0 sein, dann käme das Eis sofort (Review K3)
      if (clockOk && !skUsable && !chatFrozen) coldMoment('estimate', now, now + FROST_ESTIMATE_MS)
      // Erfolgsserie erreicht eine Marke (5, 10, 15 …): Pokal/Medaille statt des normalen Abschlusses
      if (strain.streak > 0 && strain.streak % STREAK_STEP === 0) facts = { ...facts, streakAt: now }
      factsChanged($, now)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    // Subagenten-Tools (agentId) ändern die Hauptstimmung nicht; eine offene Rückfrage eines Subagenten räumen wir aber mit auf
    if (e.agentId) {
      // Subagent (auch Hintergrund, Worktree, Workflow, Teammate) ist aktiv: zählt für die Stimmung "Subagenten" bzw. "Schwarm"
      try {
        const isNew = !agentSeen.has(e.agentId)
        const at = await $.clock.now()
        agentSeen.set(e.agentId, at)
        facts = { ...facts, agents: [...agentSeen.values()] }
        if (isNew) factsChanged($, at)
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      try {
        return await next(e)
      } finally {
        if (askTool === id) {
          askTool = ''
          facts = { ...facts, ask: false }
          factsChanged($)
        }
      }
    }
    const isQuestion = e.tool === 'AskUserQuestion'
    // Beobachtend: wirft die Uhr, geht der Tool-Aufruf trotzdem durch, nur ohne Stimmung (Review 2, K8)
    let now: number
    try {
      now = await $.clock.now()
    } catch (err) {
      $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      return next(e)
    }
    // Shell-Befehle genauer: Commit/Push bzw. Tests/Checks (nur Mustervergleich, der Befehl wird nicht gespeichert)
    const base = toolKind(e.tool)
    const kind = base === 'shell' ? shellKind((e as { command?: unknown }).command) : base
    running.set(id, { kind, since: now })
    facts = { ...facts, tool: latestTool(), ask: isQuestion || facts.ask, askSince: isQuestion && !facts.ask ? now : facts.askSince }
    factsChanged($, now)
    let res: Awaited<ReturnType<typeof next>> | undefined
    try {
      res = await next(e)
      return res
    } finally {
      // Laune: nur die Markierung zählt (Fehler bzw. abgelehnt), der Inhalt des Ergebnisses wird nicht gelesen
      if (res && (res.isError === true || typeof res.deny === 'string')) {
        strain = addHit(strain, now, res.isError === true ? SETBACK.toolError : SETBACK.denied)
        turnHadError = true
      } else if (!res) {
        strain = addHit(strain, now, SETBACK.toolError)
        turnHadError = true
      }
      running.delete(id)
      if (isQuestion || askTool === id) {
        askTool = ''
        facts = { ...facts, ask: false }
      }
      // Nachlauf (mood.ts TOOL_LINGER_MS): seine Arbeit bleibt kurz die Stimmung, auch wenn das Tool schon fertig ist
      let endedAt = now
      try {
        endedAt = await $.clock.now()
      } catch {
        // ohne Uhr zählt der Beginn als Ende: der Nachlauf wird nur kürzer
      }
      facts = { ...facts, tool: latestTool(), lastTool: isQuestion ? facts.lastTool : { kind, endedAt } }
      factsChanged($, endedAt)
    }
  })

  on('tool.check', async ($, e, next) => {
    const decision = await next(e)
    // Eine Rückfrage ist gemeint, wenn die Kette bei einem echten Aufruf (`tool_use_id`) `ask` meldet. Ob der Modus sie danach selbst
    // bewilligt (z. B. "Berechtigungen umgehen"), sieht dieses Modul nicht; die Frage gilt bis das Tool endet.
    if (decision.decision === 'ask' && e.tool_use_id) {
      askTool = e.tool_use_id
      let now: number | undefined
      try {
        now = await $.clock.now()
        if (!facts.ask) facts = { ...facts, askSince: now }
      } catch {
        // ohne Uhr keine Steigerung, die Rückfrage gilt trotzdem
      }
      facts = { ...facts, ask: true }
      factsChanged($, now)
    }
    return decision
  })

  // Komprimieren des Hauptgesprächs (nicht das Vorausrechnen `precompute`, nicht das eines Subagenten): solange es läuft
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    try {
      const at = await $.clock.now()
      facts = { ...facts, compactSince: at }
      factsChanged($, at)
    } catch (err) {
      $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
    }
    try {
      return await next(e)
    } finally {
      facts = { ...facts, compactSince: undefined }
      factsChanged($)
    }
  })

  // Ein Skill startet: kurz zeigen (nur der Name zählt als Ereignis, der Text wird nicht gelesen)
  on('skill.prompt', async ($, e, next) => {
    try {
      const at = await $.clock.now()
      facts = { ...facts, skillAt: at }
      factsChanged($, at)
    } catch (err) {
      $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    // Zuerst weiterreichen: das Tippen darf nie verzögert werden. Keine `$`-Aufrufe pro Taste außer dem gedrosselten invalidate.
    const result = await next(e)
    const gap = performance.now() - typingPerf
    typingPerf = performance.now()
    // Eis (0.13.0): je Tipp-Schub eine Riss-Stufe (höchstens 3). Die Zeit kommt aus der letzten Zeichnung, kein `$`-Aufruf je Taste.
    const fr = facts.frost
    if (fr && fr.sentAt === undefined && fr.cracks < 3 && clockAt && gap >= FROST_BURST_MS && !facts.turnActive) {
      const now = clockAt.clock + (typingPerf - clockAt.perf)
      if (now >= fr.at) {
        facts = { ...facts, frost: { ...fr, cracks: fr.cracks + 1 } }
        factsChanged($, now)
      }
    }
    // Desktop: die Animation sieht das Mitlesen TYPING_MS lang voraus, also reicht eine Neuzeichnung je halbem Fenster
    if (typingPerf - typingInvalidatedPerf > (deskTimer ? TYPING_MS / 2 : 1000)) {
      typingInvalidatedPerf = typingPerf
      $.ui.invalidate('ui.render')
    }
    // Anwesenheit höchstens alle 30 s vermerken (erste Taste nach einer Pause zählt sofort)
    if (typingPerf - seenPerf > 30_000) {
      seenPerf = typingPerf
      try {
        await noteSeen($, await $.clock.now())
      } catch (err) {
        $.ui.log(`clawd-buddy: presence not noted: ${String(err)}`, { to: 'debug' })
      }
    }
    return result
  })

  // ---- Meldungen des Clients (Ärger-Zähler persistieren)
  on('ui.message', async ($, e, next) => {
    const data = e.data as { k?: string; annoy?: number } | null
    if (data && data.k === 'stat' && typeof data.annoy === 'number') {
      annoy = data.annoy
      try {
        await save($)
      } catch (err) {
        $.ui.log(`clawd-buddy: saving failed: ${String(err)}`, { to: 'debug' })
      }
    }
    return next(e)
  })

  // ---- /clawd
  on('command.run', { command: 'clawd' }, async ($, e) => {
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2), vor allem anderen: liest weder Speicher noch Uhr; fängt Fehler selbst ab
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: 'clawd-buddy', cmd: 'clawd', lang }, e.args) }
    // Hilfe: nur `help` oder `?` als einziges Wort (docs/HELP-SPEC.md §2)
    if (isHelp(e.args)) {
      const data = clawdHelp({ lang, enabled, enabledSetting, nightStart, nightEnd, idleSeconds, reduced, side: flip ? 'left' : 'right', birthday, ice: iceWhenCold })
      let now = 0
      try {
        now = await $.clock.now()
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      const tag = `#${(++helpNo).toString(36)}${now.toString(36).slice(-5).padStart(5, '0')}`
      helps.set(tag, data)
      while (helps.size > 10) helps.delete(helps.keys().next().value as string)
      return { text: helpMarkdown(data, tag) }
    }
    // Ohne Argument ist `args` "" (types:1616): dann Status
    const [first, ...rest] = e.args.trim().split(/\s+/)
    const sub = first || 'status'
    const arg = rest.join(' ').trim()
    // Nur die Unterbefehle aus SUBCOMMANDS (clawdhelp.ts; ein Test prüft jeden gegen die Hilfe). Sonst Kurzhilfe und Verweis (HELP-SPEC §2)
    if (!(SUBCOMMANDS as readonly string[]).includes(sub)) return { text: `${tx.unknown(sub)} ${tx.help} ${tx.seeHelp}` }
    // demo, nap und freeze zeigen ihn in dieser Sitzung (0.14.0: nicht mehr gespeichert; ein Schreiben nach userConfig lüde die Mod im
    // Terminal neu und bräche die Vorführung ab). Dauerhaft an: /clawd on oder die Einstellung.
    const ensureOn = async () => {
      if (enabled) return
      enabled = true
      publishBand($)
    }
    if (sub === 'on' || sub === 'off') {
      const want = sub === 'on'
      // Schreibt `enabled` in userConfig (SETTINGS-SPEC §4). Weg 1 lädt die Mod neu (die neue Instanz liest den Wert), Weg 2 hier nachziehen.
      const r = await writeSettings($, 'clawd-buddy', SETTINGS, { enabled: want }, lang)
      if (!r.ok) return { text: writeNote(r, lang) }
      const was = enabled
      enabled = want
      enabledSetting = want
      publishBand($)
      if (!enabled) {
        deskTimer?.cancel()
        deskTimer = null
      }
      // Erst direkt vor dem Neuzeichnen: ein Zeichnen während der `await`s davor verbrauchte das Flag sonst mit dem alten Stand (Review 2, S1).
      if (enabled && !was) deskFresh = true
      else deskForce = true
      $.ui.invalidate('ui.render')
      return { text: `${enabled ? tx.on : tx.off}\n\n${writeNote(r, lang)}` }
    }
    if (sub === 'list') {
      const groups = new Map<string, string[]>()
      for (const c of ALL_CLIPS) if (c.cat !== 'transition') groups.set(c.cat, [...(groups.get(c.cat) ?? []), c.name])
      return { text: [...groups].map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n') }
    }
    if (sub === 'demo') {
      if (!arg) return { text: tx.demoUsage }
      const exact = ALL_CLIPS.find((c) => c.name === arg)
      // Gesucht wird in beiden Sprachen (Name, deutsche und englische Bezeichnung)
      const q = arg.toLowerCase()
      const part = ALL_CLIPS.filter((c) => c.name.includes(arg) || c.label.toLowerCase().includes(q) || clipLabel('en', c).toLowerCase().includes(q))
      const hit = exact ?? part[0]
      if (!hit) return { text: tx.demoNone(arg) }
      demo = hit.name
      demoN += 1
      await ensureOn()
      // Desktop: wirkt ab der nächsten Zeichnung (desk.ts)
      desk?.request({ play: hit.name })
      deskForce = true
      $.ui.invalidate('ui.render')
      const more = part.length > 1 && !exact ? tx.demoMore(part.slice(1, 5).map((c) => c.name).join(', ')) : ''
      return { text: tx.demoPlays(hit.name, clipLabel(lang, hit)) + more }
    }
    if (sub === 'nap') {
      napN += 1
      await ensureOn()
      desk?.request('nap')
      deskForce = true
      $.ui.invalidate('ui.render')
      return { text: tx.nap }
    }
    if (sub === 'freeze') {
      // Sofort einfrieren, ohne Würfel; zählt nicht für „einmal pro Chat“ (SPEC Teil A)
      let now = 0
      try {
        now = await $.clock.now()
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
        return { text: tx.freezeFail }
      }
      await ensureOn()
      facts = { ...facts, frost: { at: now, src: 'manual', cracks: 0 } }
      frostInfo = { src: 'manual', rolled: false, result: 'frozen' }
      deskForce = true
      $.ui.invalidate('ui.render')
      return { text: tx.freeze }
    }
    if (sub === 'boop') {
      boopN += 1
      desk?.request('boop')
      deskForce = true
      $.ui.invalidate('ui.render')
      return { text: 'boop!' }
    }
    if (sub === 'flicker') {
      if (!desk || !deskTimer) return { text: tx.flickerNone }
      deskDiag = -2
      deskDiagRounds = 0
      $.ui.invalidate('ui.render')
      return { text: tx.flicker }
    }
    if (sub === 'status') {
      let now = facts.endedAt
      try {
        now = await $.clock.now()
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      const t = deriveTemper(strain, now)
      const m = tx.mood
      const mood = t.temper <= -0.6 ? m.veryGrumpy : t.temper <= -0.2 ? m.grumpy : t.temper >= 0.5 ? m.great : t.temper >= 0.2 ? m.good : m.even
      const fb = facts.beat
      const beatText = tx.beat(fb ? { bpm: fmt(lang, fb.bpm, 1), group: tx.groups[fb.group ?? 'none'], sure: fb.sure } : null)
      const deskInfo = meterText(lang, meter, performance.now())
      meter = newMeter()
      const text = tx.status({ on: enabled, mood, temper: fmt(lang, t.temper, 2), tired: Math.round(t.tired * 100), annoy, desk: deskInfo, beat: beatText })
      noteFrozen(now)
      const fr = facts.frost
      const pending = fr && fr.sentAt === undefined && now < fr.at ? new Date(fr.at) : null
      const at = pending ? `${String(pending.getHours()).padStart(2, '0')}:${String(pending.getMinutes()).padStart(2, '0')}` : ''
      const ice = tx.frost({ ...frostInfo, at: frostInfo.result === 'frozen' ? at : '', chat: chatFrozen })
      return { text: `${text} ${ice} ${tx.help}` }
    }
    // Nicht erreichbar, solange jeder Eintrag von SUBCOMMANDS oben einen Zweig hat; Schutz, falls beide auseinanderlaufen
    return { text: `${tx.unknown(sub)} ${tx.help} ${tx.seeHelp}` }
  })

  // ---- /clawd help als Tabelle an der Stelle der Befehlsausgabe: „a hook's own tree draws in the row's place“ (types CommandOutput).
  // `command` gehört zu den Props, daher `props: { command }` im Matcher (wie cost-ledger /ledger).
  on('ui.render', { component: 'CommandOutput', props: { command: 'clawd' } }, async ($, e, next) => {
    // Nur die Antwort auf `help`/`?`: eine Kennung, die jemand als Argument eintippt (`/clawd demo #…`), zeichnet keine Hilfe
    // (`args` ist ein Prop von CommandOutput, types@2.1.295:10044-10048)
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop') || !isHelp(e.props.args ?? '')) return next(e)
    // Die Kennung nicht am Zeilenanfang suchen: vor der Antwort steht „clawd-buddy: “ (templates/help/README.md, Befunde)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const data = tag ? helps.get(tag) : undefined
    return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, ACCENT) : next(e)
  })

  // ---- Zeichnen
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Was andere Mods ins Band zeichnen, bleibt erhalten (interface.md:210)
    const drawStart = performance.now()
    const theirs = await next(e)
    const othersMs = performance.now() - drawStart
    try {
      if (!enabled) return theirs
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return theirs
      // Ebenen anderer Mods (Quick-Replies, sidekick) bleiben über dem Grund, nie neben Clawd, egal wer in der Kette außen liegt
      // (band.ts, docs/BAND.md). Clawd kommt nur neben den Grund (z. B. die Limit-Balken).
      const { layers, slots, base } = splitBand(theirs)
      const now = await $.clock.now()
      clockAt = { clock: now, perf: performance.now() }
      // Schnittstelle zu sidekick: dessen `$.state`-Wert lesen. Das Lesen beim Zeichnen abonniert ihn, ein Schreiben von sidekick
      // zeichnet das Band neu (types:3308-3313). Ohne sidekick bleibt er leer.
      try {
        const sk = await $.state.get({ plugin: 'sidekick', key: 'buddy' })
        const v = sidekickValue(sk.value)
        if (JSON.stringify(v) !== JSON.stringify(facts.sidekick ?? null)) facts = { ...facts, sidekick: v }
        // Eis (0.13.0): sidekick prüft oder fragt nach dem Senden, das zählt als gesendet (wie turn.start)
        if (v && (v.kind === 'check' || v.kind === 'stop') && facts.frost && v.at >= facts.frost.at) frostSent(now)
      } catch (err) {
        $.ui.log(`clawd-buddy: sidekick state not read: ${String(err)}`, { to: 'debug' })
      }
      // sidekick.status (0.13.0, nur level und cold): meldet sidekick kalt, beginnt ein kalter Moment; ist der Wert brauchbar, entfällt die
      // eigene Schätzung. Das Lesen abonniert den Wert (types:3308-3313). Ohne sidekick bleibt alles bei der Schätzung.
      try {
        const ss = sidekickStatus((await $.state.get({ plugin: 'sidekick', key: 'status' })).value)
        skUsable = !!ss && ss.level !== 'off'
        const cold = skUsable && !!ss?.cold
        if (cold && !skCold) coldMoment('sidekick', now)
        skCold = cold
        if (skUsable && facts.frost?.src === 'estimate' && facts.frost.sentAt === undefined && now < facts.frost.at) {
          facts = { ...facts }
          delete facts.frost
        }
        // Eine eigene Schätzung, die noch nicht begonnen hat, gilt nicht mehr: sidekick kennt den Cache (Status-Zeile ohne alten Wurf)
        if (skUsable && frostInfo.src === 'estimate' && !(facts.frost?.src === 'estimate')) frostInfo = { src: '', rolled: false, result: '' }
      } catch (err) {
        $.ui.log(`clawd-buddy: sidekick status not read: ${String(err)}`, { to: 'debug' })
      }
      // Schnittstelle zu tune-strip (0.9.0): spielt gerade Musik? Nur das Flag, kein Titel. Ohne tune-strip bleibt es aus.
      try {
        const sp = await $.state.get({ plugin: 'tune-strip', key: 'playing' })
        const m = musicValue(sp.value)
        if (m !== (facts.music ?? false)) facts = { ...facts, music: m }
        // Spielt Musik, beginnt kein neues Einfrieren (eine geplante Schätzung entfällt); schon gefroren bleibt er gefroren (0.13.0)
        if (m && facts.frost && facts.frost.sentAt === undefined && now < facts.frost.at) {
          facts = { ...facts }
          delete facts.frost
          frostInfo = { ...frostInfo, result: 'music' }
        }
      } catch (err) {
        $.ui.log(`clawd-buddy: tune-strip state not read: ${String(err)}`, { to: 'debug' })
      }
      // Takt und Gruppe des Songs (0.11.0, tune-strip.beat): streng geprüft, Unsinn heißt „ohne Takt“. Abonniert wie `playing`
      try {
        const sb = await $.state.get({ plugin: 'tune-strip', key: 'beat' })
        const b = beatValue(sb.value)
        if (JSON.stringify(b ?? null) !== JSON.stringify(facts.beat ?? null)) {
          facts = { ...facts }
          if (b) facts.beat = b
          else delete facts.beat
        }
      } catch (err) {
        $.ui.log(`clawd-buddy: tune-strip beat not read: ${String(err)}`, { to: 'debug' })
      }
      // Client-Props dürfen kein `undefined` enthalten (die Engine lehnt sie ab): leere Felder weglassen
      const f: Facts = JSON.parse(JSON.stringify(facts)) as Facts
      if (typingPerf > 0) f.typingAt = now - (performance.now() - typingPerf)
      const { Box, Client } = $.ui.resolve(e)
      const buddyProps = {
        // Zeichnet ein anderer Mod links daneben, bekommt er 44 Spalten (Clawd behält mindestens 40)
        columns: base ? Math.min(e.props.bodyColumns, Math.max(40, e.props.bodyColumns - 44)) : e.props.bodyColumns,
        maxRows: e.props.maxRows,
        now,
        nightStart,
        nightEnd,
        idleSeconds,
        reduced,
        flip,
        birthday,
        seed,
        facts: f,
        strain,
        demo,
        demoN,
        napN,
        boopN,
        annoy,
      }
      if (e.surface === 'desktop') {
        // Desktop: Engine im Hooks-Modul, Bild als animiertes Svg (deckende Figur auf durchsichtigem Grund), direkt über der Eingabe.
        if (!desk) {
          desk = createDesk({ seed, nightStart, nightEnd, idleSeconds, reduced, flip, birthday })
        }
        let stalled = false
        if (deskTimer && deskBeats !== deskBeatsSeen) {
          deskBeatsSeen = deskBeats
          deskBeatsSeenAt = now
        } else if (deskTimer && now - deskBeatsSeenAt >= DESK_IDLE_CHECKS * DESK_CHECK) {
          // Keine Runde seit ~2 s: eine Periode wurde abgelehnt, der Wächter ist still beendet
          deskTimer.cancel()
          deskTimer = null
          stalled = true
          // Die tote Zeit nachziehen: deskPlanMs rechnet in Uhrzeit, sonst käme die nächste Bitte um diese Zeit zu spät
          deskChecks = Math.max(deskChecks, Math.floor((now - deskDrawnAt) / DESK_CHECK))
          $.ui.log('clawd-buddy: desk watcher stalled (period refused?), restarted', { to: 'debug' })
        }
        if (!deskTimer) {
          if (!stalled) {
            deskFresh = true // die Sitzung wird (wieder) angezeigt: neu zeichnen
            // Der Wächter startet neu: die Sitzung wird (wieder) angezeigt, Fynn schaut also hin
            try {
              await noteSeen($, now)
            } catch (err) {
              $.ui.log(`clawd-buddy: presence not noted: ${String(err)}`, { to: 'debug' })
            }
          }
          deskBeats = 0
          deskBeatsSeen = 0
          deskBeatsSeenAt = now
          deskTimer = $.clock.every(DESK_CHECK, () => {
            deskBeats += 1
            // Aus oder die App zeichnet das Band nicht mehr (z. B. Sitzung verdeckt): Wächter beenden; das nächste Zeichnen startet ihn neu
            if (!desk || !enabled || deskAsked > DESK_IDLE_CHECKS) {
              deskTimer?.cancel()
              deskTimer = null
              return
            }
            if (deskDiag !== -1) {
              // Flacker-Test: alle zwei Runden zeichnen; die Bilder hängen nur an der Uhrzeit
              deskAsked = 0
              deskChecks += 1
              deskDiagRounds += 1
              if (deskDiagRounds > DIAG_MS / DESK_CHECK + DESK_IDLE_CHECKS) {
                deskDiag = -1
                deskFresh = true
              }
              if (deskChecks % 2 === 0) $.ui.invalidate('ui.render')
              return
            }
            deskChecks += 1
            if (deskAsked > 0) deskAsked += 1
            else if (deskChecks * DESK_CHECK >= deskPlanMs - DESK_LEAD) {
              deskAsked = 1
              $.ui.invalidate('ui.render')
            }
          })
        }
        const { Svg } = $.ui.resolve(e)
        // 0.12.1: Clawd liegt HINTER der Zeile (Fynn, 2026-11-04: limit-bars 0.13.0 ist breiter geworden und schob ihn weg; „nicht den
        // Raum kleiner machen, sondern dahinter legen“). Seine Bühne steht als Platz 0 vorn in der Zeile, aus dem Fluss genommen
        // (`position: absolute`, types:946-958: kein Platz unter den Geschwistern) und am Rand der Zeile festgemacht. Was später kommt
        // (limit-bars, tune-strip), wird darüber gemalt. Platz 30 bleibt als 1 px schmaler Halter für die Höhe, sonst schneidet das Band
        // die 56 px hohe Bühne ab, wenn die anderen flacher sind. Die gemeldete Breite (400 px) bleibt, damit tune-strip weiter weicht.
        // Nur rechts und ohne Umfrage (Review 0.12.1 S2, S3): links läge die Bühne fast ganz unter limit-bars, und eine Umfrage der
        // App steht im Rest der Zeile rechtsbündig, also genau unter der Bühne. Dann wie bis 0.12.0 als Platz 30 im Fluss.
        const behind = !flip && !e.props.hasSurvey
        const stage = (source: string, frame?: true) => Box({
          key: 'buddy',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          // Nie zusammendrücken: sonst schneidet ein schmales Band das 400-px-Bild ab, und mit ihm die Hand (Fynn, 2026-10-06)
          flexShrink: 0,
          // Als Bild (ohne isInteractive): SMIL läuft, und beim Wechsel bleibt das alte stehen, bis das neue fertig ist. Den Rahmen
          // (`frame`) gibt es nur noch im Flacker-Test zum Vergleich.
          children: [Svg({ source, alt: tx.alt, width: W * DESK_SCALE, height: H * DESK_SCALE, ...(frame ? { isInteractive: frame } : {}) })],
        })
        const deskBand = (source: string, frame?: true) => joinBand(layers, base, behind
          ? [
              ...slots,
              Box({ key: `slot:${BACK_SLOT}:clawd-buddy`, position: 'absolute', bottom: 0, right: 0, flexDirection: 'column', justifyContent: 'flex-end', children: [stage(source, frame)] }),
              slot(SLOTS.clawdBuddy, 'clawd-buddy', Box({ key: 'buddy-room', flexShrink: 0, children: [Svg({ source: ROOM_SVG, alt: '', width: 1, height: H * DESK_SCALE })] }), 'right'),
            ]
          : [...slots, slot(SLOTS.clawdBuddy, 'clawd-buddy', stage(source, frame), flip ? 'left' : 'right')])
        if (deskDiag !== -1) {
          if (deskDiag === -2) deskDiag = now
          const t = now - deskDiag
          if (t < DIAG_MS) {
            const step = Math.floor(t / DIAG_STEP)
            const part = Math.floor(t / (DIAG_MS / 2)) + 1
            const still = stillSource(DESK_SCALE, flip, part, step)
            return part === 1 ? deskBand(still) : deskBand(still, true)
          }
          deskDiag = -1
          deskFresh = true
        }
        const calcStart = performance.now()
        const fNow = deskFacts(now)
        const shape = `${layers.map((l) => nameOf(l)).join(',')}|${e.props.bodyColumns}|${e.props.maxRows}`
        const fresh = deskFresh || deskSvg === '' || shape !== deskShape
        // Zeichnung nur für andere Mods (ohne eigenen Anlass): wird gezählt, aber nicht mehr mit dem alten Svg beantwortet (0.8.1, siehe oben)
        if (!fresh && !deskForce && deskAsked === 0 && desk.divergence(now, fNow, strain) > DESK_LEAD && desk.remaining(now) > DESK_LEAD) {
          meter.foreign += 1
        }
        // Stand so auf jetzt nachziehen, wie die gezeigte Animation lief, dann ab jetzt mit den neuen Fakten vorausrechnen
        const plan = desk.draw(now, fNow, strain, DESK_SCALE)
        if (fresh) {
          if (!deskFresh && shape !== deskShape && deskSvg !== '') meter.freshShape += 1
          else meter.freshShown += 1
        }
        deskSvg = plan.source
        deskDrawnAt = now
        deskShape = shape
        deskForce = false
        deskFresh = false
        deskPlanMs = plan.ticks * DESK_TICK
        deskChecks = 0
        deskAsked = 0
        const calc = performance.now() - calcStart
        meter.draws += 1
        meter.planSecs += deskPlanMs / 1000
        meter.changes += plan.changes
        meter.chars += plan.source.length
        meter.calcSum += calc
        meter.calcMax = Math.max(meter.calcMax, calc)
        const drawMs = performance.now() - drawStart
        meter.drawSum += drawMs
        meter.drawMax = Math.max(meter.drawMax, drawMs)
        meter.othersSum += othersMs
        return deskBand(deskSvg)
      }
      // Eine Zeile: Clawd ist ein Platz (30) neben den anderen Plätzen; was sonst im Band steht, füllt die Mitte
      return joinBand(layers, base, [...slots, slot(SLOTS.clawdBuddy, 'clawd-buddy',
        Box({ flexDirection: 'column', justifyContent: 'flex-end', children: [Client({ key: 'buddy', module: './buddy.ts', props: buddyProps })] }), flip ? 'left' : 'right')])
    } catch (err) {
      $.ui.log(`clawd-buddy ui.render: ${String(err)}`, { to: 'debug' })
      return theirs
    }
  })
}
