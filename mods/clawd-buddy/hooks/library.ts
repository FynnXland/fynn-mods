// clawd-buddy: Bibliothek = alle Requisiten und Clips an einer Stelle (reine Daten, nur Importe und Zusammenführung).
// Eine neue Clip-Gruppe wird hier eingetragen. Requisiten-Namen müssen über alle Gruppen eindeutig sein.
import { BASE_PROPS } from './props.js'
import type { PropTable } from './stage.js'
import type { ClipDef } from './clipdef.js'
import * as idle from './clips/idle.js'
import * as fun from './clips/fun.js'
import * as work from './clips/work.js'
import * as agent from './clips/agent.js'
import * as wait from './clips/wait.js'
import * as done from './clips/done.js'
import * as night from './clips/night.js'
import * as mouse from './clips/mouse.js'
import * as transitions from './clips/transitions.js'
import * as sidekick from './clips/sidekick.js'
import * as extra from './clips/extra.js'
import * as hints from './clips/hints.js'
import * as music from './clips/music.js'
import * as frost from './clips/frost.js'

const groups = [idle, fun, work, agent, wait, done, night, mouse, transitions, sidekick, extra, hints, music, frost]

export const ALL_CLIPS: readonly ClipDef[] = groups.flatMap((g) => g.CLIPS)
/**
 * Requisiten mit Schrift, Zeichen oder Uhrzeigern: beim Spiegeln eines Clips nicht umdrehen (Fynn: ein gespiegeltes „?“ ist keins).
 * Fragezeichen/Ausrufezeichen, zZ, Häkchen, Fragezeichen-Schild, Klemmbrett, Test-Liste, Kalender, Uhren, Upload-Pfeil; sidekick: Haken, „!“.
 */
const NO_FLIP = /^(question|excl|zs|zb|mood_excl|mood_z\d|wait_sign|wait_cal\d|wait_clock\d|work_ok\d|work_ex|work_zB|work_zS|work_cb\d|work_up|sk_tick|sk_excl|sk_noteB)$/
const merged: PropTable = Object.assign({}, BASE_PROPS, ...groups.map((g) => g.PROPS))
export const ALL_PROPS: PropTable = Object.fromEntries(
  Object.entries(merged).map(([k, v]) => [k, NO_FLIP.test(k) ? { ...v, noFlip: true as const } : v]),
)

/** Anzeigenamen der Kategorien (Galerie und Prüfwerkzeuge). */
export const CAT_LABEL: Readonly<Record<string, string>> = {
  idle: 'Grundpose', fun: 'Zeitvertreib', work_write: 'Arbeiten: schreiben', work_read: 'Arbeiten: lesen',
  work_shell: 'Arbeiten: Shell', work_web: 'Arbeiten: Web', work_agent: 'Arbeiten: Subagent', work_git: 'Arbeiten: Commit/Push', work_test: 'Arbeiten: Tests/Checks', limit_5h: 'Limit: 5 Stunden erreicht', limit_week: 'Limit: Woche erreicht', limit_back: 'Limit: zurückgesetzt', agent_done: 'Subagent fertig', streak: 'Erfolgsserie', waitUserLong: 'Wartet lange auf dich', work_think: 'Arbeiten: denken',
  wait10: 'Warten (> 10 s)', wait60: 'Warten (> 60 s)', waitUser: 'Wartet auf dich', watching: 'Du tippst',
  sk_check: 'sidekick prüft deine Nachricht', sk_stop: 'sidekick hält deine Nachricht an', sk_handoff: 'sidekick baut einen neuen Chat', sk_fresh: 'Neuer Chat ist da',
  sk_stop_cold: 'sidekick fragt: Cache ist kalt', sk_stop_wrong: 'sidekick fragt: falscher Chat?', sk_stop_model: 'sidekick fragt: anderes Modell?', sk_stop_rewrite: 'sidekick bietet eine kürzere Fassung an', sk_stop_topic: 'sidekick fragt: neues Thema, neuer Chat?', sk_hint: 'sidekick setzt einen Hinweis', sk_upkeep: 'sidekick meldet Wartung',
  frost_in: 'Friert ein', frozen: 'Eingefroren', frost_crack: 'Eis bekommt Risse', frost_break: 'Eis zerbricht', frost_melt: 'Eis schmilzt',
  compact: 'Komprimiert den Verlauf', skill: 'Skill startet', ctx_full: 'Kontext fast voll', done_long: 'Langer Turn geschafft',
  music: 'Musik (tune-strip spielt)', done: 'Fertig', oops: 'Fehler', night: 'Nacht', morning: 'Morgen', mouse: 'Maus', transition: 'Übergänge',
}
