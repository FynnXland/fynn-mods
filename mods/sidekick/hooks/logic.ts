// sidekick: Logik ohne `$`. Regeln (SPEC Verhalten 3), Prompts für Prüfung und Übergabe und Antwort-Parser, Kürzung des Verlaufs,
// Ersparnis-Buchungen und /savings (SPEC Verhalten 8). Alles hier ist rein und wird direkt getestet.
import { MIN, dayKey, parseTokens, priceFor, rewriteCost } from './cache.ts'
import type { CompleteUsage } from './cache.ts'
import { dec, lang, shortDate, spanText, t, tokensText, usdText } from './i18n.ts'
import { HANDOFF, modelLabel } from './models.ts'
import { RULE_IDS } from './wartung.ts'
import type { RuleId } from './wartung.ts'

// ---------- Einstellungen ----------

export type Settings = {
  on: boolean
  threshold: number // Auslöser (b): Kontext ab hier
  big: number // Auslöser (c): kalt und Kontext ab hier
  skills: boolean // Skill-Liste an die Prüfung
  ttl: 0 | 5 | 60 // 0 = gemessen/Standard
}

export const DEFAULT_SETTINGS: Settings = { on: true, threshold: 80000, big: 150000, skills: true, ttl: 0 }

export function cleanSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : d)
  return {
    on: typeof o.on === 'boolean' ? o.on : DEFAULT_SETTINGS.on,
    threshold: num(o.threshold, DEFAULT_SETTINGS.threshold),
    big: num(o.big, DEFAULT_SETTINGS.big),
    skills: typeof o.skills === 'boolean' ? o.skills : DEFAULT_SETTINGS.skills,
    ttl: o.ttl === 5 || o.ttl === 60 ? o.ttl : 0,
  }
}

/** `/sidekick <key> <value>` (Befehle und Argumente englisch); null, wenn nichts davon passt. */
export function applySetting(s: Settings, args: string): Settings | null {
  const [key, value] = args.trim().toLowerCase().split(/\s+/)
  if (key === 'on') return { ...s, on: true }
  if (key === 'off') return { ...s, on: false }
  if (key === 'threshold' || key === 'big') {
    const n = parseTokens(value ?? '')
    return n ? { ...s, [key]: n } : null
  }
  if (key === 'skills' && (value === 'on' || value === 'off')) return { ...s, skills: value === 'on' }
  if (key === 'ttl') {
    if (value === '5') return { ...s, ttl: 5 }
    if (value === '60') return { ...s, ttl: 60 }
    if (value === 'auto') return { ...s, ttl: 0 }
  }
  return null
}

export const USAGE = '`/sidekick on|off` · `status` · `threshold 80k` · `big 150k` · `skills on|off` · `ttl 5|60|auto` · `hints …`'

// ---------- Regeln ----------

export type Trigger = 'a' | 'b' | 'c'
const TRIGGER_TEXT: Record<Trigger, string> = {
  a: 'erste Nachricht des Chats',
  b: 'Kontext über der Schwelle',
  c: 'Cache kalt und Kontext groß',
}

/** Auslöser aus Schritt 2 (SPEC Verhalten 3.2); (c) vor (a) vor (b). */
export function triggerOf(f: { first: boolean; ctx: number; cold: boolean; unknown?: boolean; settings: Settings }): Trigger | null {
  // Unbekannt (sidekick sieht einen Chat mit Verlauf zum ersten Mal) gilt vorsichtig wie kalt (597k kalt
  // durchgelassen); bei der ersten Nachricht eines Chats gibt es nichts neu zu schreiben
  if ((f.cold || (f.unknown && !f.first)) && f.ctx >= f.settings.big) return 'c'
  if (f.first) return 'a'
  if (f.ctx >= f.settings.threshold) return 'b'
  return null
}

export const ARTS = ['neuer_chat', 'falscher_chat', 'skill', 'fassung', 'modell', 'sonstiges'] as const
export type Art = (typeof ARTS)[number]

/** Ignorierter Hinweis-Typ: Kontext und Commit-Zähler, als er ignoriert wurde. */
export type Ignored = Partial<Record<Art, { ctx: number; commits: number }>>

/** Wieder anbieten erst nach ≥ 50k mehr Kontext oder einem Commit dazwischen (SPEC Verhalten 3.2). */
export function isSuppressed(ign: Ignored, art: Art, ctx: number, commits: number): boolean {
  const i = ign[art]
  if (!i) return false
  return ctx - i.ctx < 50000 && commits === i.commits
}

// ---------- Prüfung (Modell: CHECK in models.ts) ----------

export type Skill = { name: string; description: string }

/**
 * Anweisung für die Prüfung. Der Prompt bleibt deutsch, abweichend von release/I18N.md §2 (dort englisch): Er ist mit dem echten
 * Haiku abgestimmt und mit Sonnet 5.5 geprobt (2026-10-06), und die Probe mit `en` lieferte englische Zeilen, Kurzfassung und Übergabe. Die Ausgabesprache folgt `language`. Die Fassung bleibt in der
 * Sprache der Nachricht, weil sie die Nachricht des Nutzers ist. Neutral „der Nutzer“: Der Mod ist öffentlich.
 */
export function checkSystem(skills: Skill[] | null): string {
  const out = [
    'Du bist der Sidekick in Claude Code. Der Nutzer tippt gleich eine Nachricht an seinen Coding-Assistenten; du prüfst sie VOR dem Senden.',
    'Du chattest nie mit dem Nutzer und beantwortest die Nachricht nicht. Du gibst nur ein Urteil als JSON.',
    '',
    'Rollen (Fassungen klangen wie Antworten des Assistenten):',
    '- Drei Beteiligte: der Nutzer (schreibt), sein Coding-Assistent (bekommt die Nachricht und arbeitet) und du (stiller Prüfer davor). Du bist nicht der Assistent.',
    '- "fassung" ist die eigene Nachricht des Nutzers an den Assistenten, nur klarer. Absender bleibt der Nutzer: „ich“ ist der Nutzer, „du“ ist der Assistent. Sie gibt dem Assistenten einen Auftrag oder stellt ihm eine Frage.',
    '- Eine Fassung ist nie eine Antwort an den Nutzer, nie eine Rückfrage an den Nutzer und nie eine Begrüßung. Sätze wie „Was möchtest du machen?“, „Welches soll ich nehmen?“ oder „Ich bin bereit“ gehören dem Assistenten, nicht dem Nutzer.',
    '- Eine Fassung enthält keine neue Frage. Fragen, die der Nutzer selbst gestellt hat, bleiben; neue Fragen nach fehlenden Angaben („Was genau soll sich ändern?“) sind Rückfragen an den Nutzer und gehören nicht hinein.',
    '- Fehlt eine Angabe, die nur der Nutzer kennt, schreibe keine Fassung. Nenne die Lücke stattdessen in "zeile" (urteil "hinweis"), z. B. „Unklar, welches der drei Projekte gemeint ist.“',
    '- Beispiel 1: Der Nutzer schreibt „mach die drei projekte mal anders“, und weder Kurzfassung noch letzte Nachrichten sagen, was „anders“ heißt. Falsch: „Lass mich die drei Projekte neu angehen. Was soll sich ändern?“ (Stimme des Assistenten plus Rückfrage). Richtig: {"urteil":"hinweis","art":"fassung","zeile":"Unklar, was mit anders gemeint ist – Stil, Struktur oder Inhalt?","fassung":""}',
    '- Beispiel 2: Der Nutzer schreibt „mach das nochmal mit der datei“, und die letzte Nachricht nennt hooks/register.ts und einen Tippfehler. Richtig: {"urteil":"anhalten","art":"fassung","zeile":"Datei und Änderung ergänzt.","fassung":"Bitte korrigiere den Tippfehler in hooks/register.ts noch einmal."}',
    '- "zeile" richtet sich an den Nutzer, als kurzer Hinweis von dir. Sie beantwortet seine Nachricht nicht.',
    '',
    'Urteile:',
    '- "durch": der Normalfall. Die Nachricht passt so. Im Zweifel immer "durch".',
    '- "hinweis": eine kurze, wirklich nützliche Zeile; die Nachricht wird trotzdem gesendet. Beispiele: ein vorhandener Skill passt genau; das Thema wechselt bei großem Kontext.',
    '- "anhalten": nur bei einer klar besseren Aktion: (1) art "neuer_chat", wenn ein neues, eigenständiges Thema in einem großen oder kalten Chat beginnt; (2) art "fassung", wenn die Nachricht mehrdeutig ist und du die Lücke aus Kurzfassung oder letzten Nachrichten selbst füllen kannst. Kannst du das nicht, ist es kein "anhalten", sondern ein "hinweis" mit der Lücke in "zeile"; (3) art "falscher_chat" (siehe unten).',
    '',
    'Falscher Chat (Gebietswechsel, mehr als ein Themenwechsel):',
    '- "falscher_chat": Die neue Nachricht gehört eindeutig zu einem anderen Projekt oder Gebiet als dieser Chat: anderes Produkt, andere Codebasis oder andere Technik. Der Nutzer hat sie dann wahrscheinlich im falschen Chat getippt. Urteil immer "anhalten". Dazu zählt auch eine Aufgabe ohne jeden Bezug zum Projekt des Chats. Beispiele: Der Chat baut ein Handy-Game in Unity, die Nachricht fragt nach dem CSS-Layout einer Website; oder sie will ein Skript, das private Urlaubsfotos umbenennt.',
    '- Kein "falscher_chat" bei einem neuen Thema im selben Projekt (das ist "neuer_chat" oder "durch"), bei allgemeinen Fragen, Grüßen oder kurzen Nachrichten. Nur, wenn Kurzfassung oder letzte Nachrichten das Gebiet des Chats klar zeigen. Im Zweifel nicht.',
    '- "zeile" bei "falscher_chat": beide Gebiete knapp, z. B. Dieser Chat: Handy-Game (Unity). Deine Nachricht: Website-CSS.',
    '- "kurzfassung" bei "falscher_chat": bleibt beim Gebiet des Chats; die neue Nachricht kommt nicht hinein.',
    '',
    'Regeln:',
    '- Höchstens ein Hinweis. Kein Lob, keine Rückfragen, keine Anrede.',
    '- "art": "neuer_chat" | "falscher_chat" | "skill" | "fassung" | "modell" | "sonstiges".',
    '- "skill": nur ein Name aus der Skill-Liste unten, exakt geschrieben. Schlage nie vor, Plugins zu installieren.',
    '- "modell" nur, wenn die Fakten "Auslöser: erste Nachricht des Chats" nennen: ein kleineres Modell für einfache Aufgaben oder ein größeres für schwere.',
    '- "neuer_chat" und "falscher_chat" nie bei der ersten Nachricht eines Chats: Der Chat ist dann schon neu. Der Kontext dort ist die Grundlast (Anweisungen, Werkzeuge), kein Verlauf.',
    '- "fassung": die komplette verbesserte Nachricht, vom Nutzer an den Assistenten, in seinem Ton und in der Sprache seiner Nachricht, ohne Erfundenes. Sonst leer. Nie bei kurzen Nachrichten (unter 4 Wörtern) wie Grüßen, Tests oder „OK“.',
    `- "zeile": ein kurzer Satz, höchstens 120 Zeichen, auf ${t().outLang}, sachlich. Bei "durch" leer.`,
    '- In "zeile", "fassung" und "kurzfassung" keine doppelten Anführungszeichen (sie zerbrechen das JSON); wenn nötig ‚einfache‘.',
    '- "verlauf": braucht die neue Nachricht den bisherigen Verlauf? "braucht" = baut direkt darauf auf; "kaum" = nur Stand und Eckdaten, eine kurze Übergabe reicht; "nicht" = in sich vollständig, ginge genauso in einem leeren Chat.',
    `- "kurzfassung": schreibe die laufende Kurzfassung des Chats fort, auf ${t().outLang}, höchstens 600 Zeichen: Thema, Stand, Entscheidungen, letzter Commit. Nur aus dem, was du siehst.`,
    '',
    'Antworte nur mit einem JSON-Objekt, ohne Erklärung:',
    '{"urteil":"durch|hinweis|anhalten","art":"…","zeile":"…","fassung":"…","skill":"…","verlauf":"braucht|kaum|nicht","kurzfassung":"…"}',
  ]
  if (skills && skills.length) {
    out.push('', 'Skills (Aufruf mit /name):')
    for (const s of skills) out.push(`- ${s.name}: ${s.description}`)
  }
  return out.join('\n')
}

type CheckFacts = {
  trigger: Trigger
  ctx: number
  cache: string // „warm, noch 42 min“ / „kalt seit 14 min“ / „unbekannt“
  model: string
  commit: string // „abc123 vor 20 min“ / „keiner“
}

/** Auf höchstens `n` Zeichen, an einer Wortgrenze, mit „…“ (nie mitten im Wort). */
function cutWords(t: string, n: number): string {
  const s = String(t ?? '').trim()
  if (s.length <= n) return s
  const head = s.slice(0, n - 1)
  const space = head.lastIndexOf(' ')
  return `${(space > n * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:–-]+$/, '')}…`
}

const ZEILE_MAX = 160

export const cut = (t: string, n: number) => {
  const s = String(t ?? '')
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export function checkPrompt(summary: string, recent: string[], text: string, f: CheckFacts): string {
  const out = [`Kurzfassung bisher: ${summary || '(noch keine)'}`, '']
  out.push('Letzte eigene Nachrichten (alt → neu):')
  if (recent.length) recent.forEach((r, i) => out.push(`${i + 1}. ${cut(r, 400)}`))
  else out.push('(keine)')
  out.push(
    '',
    `Fakten: Auslöser: ${TRIGGER_TEXT[f.trigger]}; Kontext: ${tokensText(f.ctx)} Tokens; Cache: ${f.cache}; Modell: ${f.model ? priceFor(f.model).id : 'unbekannt'}; letzter Commit: ${f.commit}`,
    '',
    'Neue Nachricht:',
    '<<<',
    cut(text, 4000),
    '>>>',
  )
  return out.join('\n')
}

export type Verdict = {
  urteil: 'durch' | 'hinweis' | 'anhalten'
  art: Art
  zeile: string
  fassung: string
  skill: string
  verlauf?: Verlauf
  kurzfassung: string
}

export type Verlauf = 'braucht' | 'kaum' | 'nicht'

/** Unter so vielen Wörtern gibt es keine Fassung: Grüße, Tests, „OK“. */
const FASSUNG_MIN_WORDS = 4

/**
 * Sicherheitsnetz zur Rollenregel im Prompt: Eine Fassung, die nach einer Antwort oder Rückfrage des Assistenten klingt
 * („Ich bin bereit – was möchtest du machen?“), ist keine Nachricht des Nutzers. Nur eindeutige Floskeln, und nur, wenn der Text
 * des Nutzers sie nicht schon enthält. Erkennt Deutsch und Englisch, unabhängig von `language` (release/I18N.md §4).
 */
const REPLY_PHRASES = [
  /\bich bin bereit\b/i,
  /\bwas möchtest du\b/i,
  /\bwas willst du\b/i,
  /\bwie kann ich (dir )?helfen\b/i,
  /\bwomit kann ich\b/i,
  /\bwas soll ich (tun|machen)\b/i,
  /\bwelche[nrs]? .{0,40}\bsoll ich\b/i,
  /^\s*(gerne|klar|alles klar|verstanden)\b[!.,:–-]/i,
  /^\s*lass mich\b/i,
  /\bi'?m ready\b/i,
  /\bwhat would you like\b/i,
  /\bwhat do you want\b/i,
  /\bhow can i help\b/i,
  /\bwhat should i (do|work on)\b/i,
  /\bwhich\b.{0,40}\bshould i\b/i,
  /^\s*(sure|of course|got it|absolutely|certainly)\b[!.,:–-]/i,
  /^\s*let me\b/i,
]

const questions = (text: string) => (text.match(/\?/g) ?? []).length
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/** Antwort-Floskel des Assistenten, oder mehr Fragen als im Text des Nutzers: Rückfragen gehören in die Zeile, nicht in die Fassung. */
export function soundsLikeReply(fassung: string, msg = ''): boolean {
  if (REPLY_PHRASES.some((re) => re.test(fassung) && !re.test(msg))) return true
  // Oft wird ohne „?“ gefragt („soll ich die app neu starten“): ein Fragewort irgendwo zählt als eine Frage
  const asked = /(^|\s)(kannst|könntest|kann|soll|sollte|wie|was|warum|wieso|wo|wann|welche[nrs]?|gibt es|hast du|bist du|ist das|can|could|should|how|what|why|where|when|which|is there|do you|are you|would you)(\s|$)/i.test(msg) ? 1 : 0
  return questions(fassung) > Math.max(questions(msg), asked)
}

/**
 * Antwort der Prüfung lesen. Alles Unverwertbare ist `null` = durch (fail-open, SPEC Fehlerverhalten). Haiku setzte das JSON oft in
 * ```json-Zäune. `modell` nur bei Auslöser (a), Skills nur aus der Liste; ein „anhalten“ ohne konkrete bessere Aktion wird zum
 * Hinweis.
 */
export function parseVerdict(raw: string, trigger: Trigger, skillNames: string[], msg?: string): Verdict | null {
  const answer = String(raw || '')
  const a = answer.indexOf('{')
  const b = answer.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  let o: Record<string, unknown>
  const body = answer.slice(a, b + 1)
  try {
    o = JSON.parse(body)
  } catch {
    // Haiku schließt ein deutsches „…“ manchmal mit einem geraden " und zerbricht so das JSON (Probe 2026-10-06): reparieren, dann
    // ein zweiter Versuch; sonst bleibt es bei „durch“
    try {
      o = JSON.parse(body.replace(/„([^"“”\n]*)"/g, '„$1“'))
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object') return null
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const urteil = str(o.urteil)
  if (urteil !== 'durch' && urteil !== 'hinweis' && urteil !== 'anhalten') return null
  const art = (ARTS as readonly string[]).includes(str(o.art)) ? (str(o.art) as Art) : 'sonstiges'
  const v: Verdict = {
    urteil,
    art,
    zeile: cutWords(str(o.zeile).replace(/\s+/g, ' '), ZEILE_MAX),
    fassung: str(o.fassung),
    skill: str(o.skill).replace(/^\//, ''),
    kurzfassung: cut(str(o.kurzfassung), 600),
  }
  const verlauf = str(o.verlauf)
  if (verlauf === 'braucht' || verlauf === 'kaum' || verlauf === 'nicht') v.verlauf = verlauf
  if (v.urteil === 'durch') return v
  if (v.art === 'modell' && trigger !== 'a') return { ...v, urteil: 'durch' }
  // Bei der ersten Nachricht ist der Chat schon neu (Rat zum neuen Chat in einem frischen Chat)
  if (v.art === 'neuer_chat' && trigger === 'a') return { ...v, urteil: 'durch' }
  // Falscher Chat: immer Rückfrage (Fynn 2026-10-06: verweigern statt Zeile), nie bei der ersten Nachricht oder kurzen Nachrichten
  if (v.art === 'falscher_chat') {
    if (trigger === 'a' || (msg !== undefined && words(msg) < FASSUNG_MIN_WORDS)) return { ...v, urteil: 'durch' }
    return { ...v, urteil: 'anhalten', fassung: '' }
  }
  if (v.art === 'skill' && !skillNames.includes(v.skill)) return { ...v, urteil: 'durch' }
  if (v.art === 'fassung' && msg !== undefined && words(msg) < FASSUNG_MIN_WORDS) return { ...v, urteil: 'durch' }
  // Klingt die Fassung nach dem Assistenten, wird sie verworfen; eine Zeile bleibt als Hinweis, falls die Antwort eine hat
  if (v.fassung && soundsLikeReply(v.fassung, msg)) {
    const rest = { ...v, fassung: '', urteil: 'hinweis' as const }
    return rest.zeile ? rest : { ...rest, urteil: 'durch' }
  }
  if (v.urteil === 'anhalten' && !(v.art === 'neuer_chat' || (v.art === 'fassung' && v.fassung))) v.urteil = 'hinweis'
  if (v.urteil === 'hinweis' && !v.zeile) return { ...v, urteil: 'durch' }
  return v
}

// ---------- Übergabe (Modell: HANDOFF in models.ts) ----------

/** Vorlage wie Skill `uebergabe` von limit-bars, dazu der Zusatz aus der SPEC (Verhalten 4). Gliederung und Sprache nach `language`. */
export function handoffSystem(): string {
  const de = lang() === 'de'
  return [
    'Schreibe eine Übergabe, mit der eine neue Instanz eines Coding-Assistenten in einem frischen Chat nahtlos weiterarbeitet, ohne den alten Verlauf. Leser ist die nächste Instanz: knapp, konkret, ohne Lob.',
    `Du siehst einen Ausschnitt; erfinde nichts. Hat ein Abschnitt keinen Inhalt, steht dort „${de ? 'keine' : 'none'}“. Höchstens 400 Wörter. Pfade so, wie sie im Verlauf stehen. Schreibe auf ${t().outLang}.`,
    '',
    'Genau diese Struktur:',
    ...(de
      ? ['# Übergabe: <eine Zeile, worum es ging>', '', '> **Stand:** <ein Satz>', '> **Weiter mit:** <ein Satz, der wahrscheinlichste nächste Schritt>', '', '## Auftrag', '<1–2 Sätze>', '', '## Erledigt', '- **<Stichwort>**: <was und warum>', '', '## Zuerst lesen', '1. `<Pfad>`: <warum>', '', '## Offen', '- [ ] <Aufgabe oder Frage>']
      : ['# Handoff: <one line, what it was about>', '', '> **Status:** <one sentence>', '> **Next:** <one sentence, the most likely next step>', '', '## Task', '<1–2 sentences>', '', '## Done', '- **<keyword>**: <what and why>', '', '## Read first', '1. `<path>`: <why>', '', '## Open', '- [ ] <task or question>']),
  ].join('\n')
}

type Msg = { role: string; text?: string }

/**
 * Verlaufsende für die Übergabe: nur `text` von Nutzer und Assistent, ohne Tool-Ergebnisse, die neuesten Nachrichten bleiben,
 * insgesamt höchstens `max` Zeichen (SPEC Verhalten 4: etwa 100 000).
 */
export function historyTail(msgs: readonly Msg[], max = 100000): string {
  const parts: string[] = []
  let used = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (!m) continue
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const text = String(m.text ?? '').trim()
    if (!text) continue
    const block = `[${m.role === 'user' ? 'Nutzer' : 'Assistent'}] ${text}`
    if (used + block.length + 2 > max) {
      const room = max - used - 2
      if (room > 200) parts.push(`[${m.role === 'user' ? 'Nutzer' : 'Assistent'}] …${text.slice(-(room - 20))}`)
      break
    }
    parts.push(block)
    used += block.length + 2
  }
  return parts.reverse().join('\n\n')
}

export function handoffPrompt(summary: string, history: string): string {
  return `Laufende Kurzfassung: ${summary || '(keine)'}\n\nEnde des Verlaufs (älteste zuerst):\n\n${history || '(leer)'}`
}


// ---------- Bilanz ----------

type Counts = { gezeigt: number; angenommen: number; ignoriert: number; abgebrochen: number }

/** Eigene Modellaufrufe je Modell-ID und Rolle (SPEC Nachtrag 0.5.0): Anzahl, $ und Dauer, dazu Tokens. */
export type Use = { n: number; usd: number; ms: number }
export type Role = 'pruefung' | 'uebergabe'
export type ModelUse = Record<Role, Use> & { in: number; out: number }

export type Day = {
  kosten: number // eigene Modellaufrufe, $
  pruefungen: number
  warteMs: number // Summe der Wartezeit geprüfter Nachrichten
  uebergaben: number
  hinweise: Partial<Record<Art, Counts>>
  kaltVermieden: { n: number; usd: number }
  neuWarm: { n: number; usd: number }
  kaltOhne: { n: number; usd: number } // Kaltstarts ohne Rückfrage (Basislinie)
  skills: Record<string, number>
  wartung: Partial<Record<RuleId, { gezeigt: number; angenommen: number }>> // Wartungs-Hinweise (SPEC Nachtrag 0.2.0)
  modelle: Record<string, ModelUse> // seit 0.5.0; ältere Kosten stehen nur in `kosten`
}

export function emptyDay(): Day {
  return {
    kosten: 0,
    pruefungen: 0,
    warteMs: 0,
    uebergaben: 0,
    hinweise: {},
    kaltVermieden: { n: 0, usd: 0 },
    neuWarm: { n: 0, usd: 0 },
    kaltOhne: { n: 0, usd: 0 },
    skills: {},
    wartung: {},
    modelle: {},
  }
}

const emptyUse = (): Use => ({ n: 0, usd: 0, ms: 0 })
const emptyModel = (): ModelUse => ({ pruefung: emptyUse(), uebergabe: emptyUse(), in: 0, out: 0 })
const addUse = (a: Use, b: Use): Use => ({ n: a.n + b.n, usd: a.usd + b.usd, ms: a.ms + b.ms })

const n0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

function cleanDay(v: unknown): Day {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>
  const d = emptyDay()
  d.kosten = n0(o.kosten)
  d.pruefungen = n0(o.pruefungen)
  d.warteMs = n0(o.warteMs)
  d.uebergaben = n0(o.uebergaben)
  for (const k of ['kaltVermieden', 'neuWarm', 'kaltOhne'] as const) d[k] = { n: n0(o[k]?.n), usd: n0(o[k]?.usd) }
  for (const a of ARTS) {
    const c = o.hinweise?.[a]
    if (c) d.hinweise[a] = { gezeigt: n0(c.gezeigt), angenommen: n0(c.angenommen), ignoriert: n0(c.ignoriert), abgebrochen: n0(c.abgebrochen) }
  }
  if (o.skills && typeof o.skills === 'object') for (const [k, v] of Object.entries(o.skills)) d.skills[k] = n0(v)
  for (const id of RULE_IDS) {
    const w = o.wartung?.[id]
    if (w) d.wartung[id] = { gezeigt: n0(w.gezeigt), angenommen: n0(w.angenommen) }
  }
  if (o.modelle && typeof o.modelle === 'object')
    for (const [k, m] of Object.entries(o.modelle as Record<string, any>)) {
      if (!k || !m || typeof m !== 'object') continue
      const use = (u: any): Use => ({ n: n0(u?.n), usd: n0(u?.usd), ms: n0(u?.ms) })
      d.modelle[k] = { pruefung: use(m.pruefung), uebergabe: use(m.uebergabe), in: n0(m.in), out: n0(m.out) }
    }
  return d
}

export function addDay(a: Day, b: Day): Day {
  const out = cleanDay(a)
  out.kosten += b.kosten
  out.pruefungen += b.pruefungen
  out.warteMs += b.warteMs
  out.uebergaben += b.uebergaben
  for (const k of ['kaltVermieden', 'neuWarm', 'kaltOhne'] as const) out[k] = { n: out[k].n + b[k].n, usd: out[k].usd + b[k].usd }
  for (const a2 of ARTS) {
    const x = b.hinweise[a2]
    if (!x) continue
    const y = out.hinweise[a2] ?? { gezeigt: 0, angenommen: 0, ignoriert: 0, abgebrochen: 0 }
    out.hinweise[a2] = { gezeigt: y.gezeigt + x.gezeigt, angenommen: y.angenommen + x.angenommen, ignoriert: y.ignoriert + x.ignoriert, abgebrochen: y.abgebrochen + x.abgebrochen }
  }
  for (const [k, v] of Object.entries(b.skills)) out.skills[k] = (out.skills[k] ?? 0) + v
  for (const id of RULE_IDS) {
    const x = b.wartung[id]
    if (!x) continue
    const y = out.wartung[id] ?? { gezeigt: 0, angenommen: 0 }
    out.wartung[id] = { gezeigt: y.gezeigt + x.gezeigt, angenommen: y.angenommen + x.angenommen }
  }
  for (const [k, x] of Object.entries(b.modelle)) {
    const y = out.modelle[k] ?? emptyModel()
    out.modelle[k] = { pruefung: addUse(y.pruefung, x.pruefung), uebergabe: addUse(y.uebergabe, x.uebergabe), in: y.in + x.in, out: y.out + x.out }
  }
  return out
}

/** Einen eigenen Modellaufruf je Modell buchen; `kosten` bucht der Aufrufer wie bisher (Summe aller Modelle und älterer Tage). */
export function bookModel(d: Day, model: string, role: Role, usd: number, ms: number, u?: CompleteUsage) {
  const key = String(model || '?')
  const m = d.modelle[key] ?? emptyModel()
  m[role] = addUse(m[role], { n: 1, usd, ms: Math.max(0, ms) })
  m.in += (u?.input_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0)
  m.out += u?.output_tokens || 0
  d.modelle[key] = m
}

/** Modelle nach Betrag, dazu der Rest ohne Modell (Kosten vor 0.5.0). */
export function modelRows(d: Day): { list: { key: string; m: ModelUse; usd: number }[]; earlier: { usd: number; n: number } } {
  const list = Object.entries(d.modelle)
    .map(([key, m]) => ({ key, m, usd: m.pruefung.usd + m.uebergabe.usd }))
    .sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key))
  const usd = Math.max(0, d.kosten - list.reduce((a, x) => a + x.usd, 0))
  const n = Math.max(0, d.pruefungen - list.reduce((a, x) => a + x.m.pruefung.n, 0))
  // Rundungsreste der Summen sind kein „früher“
  return { list, earlier: usd >= 0.005 || n > 0 ? { usd, n } : { usd: 0, n: 0 } }
}

/** Ein Eintrag `bilanz:<sessionId>` bzw. `bilanz:tage`. */
export type Ledger = { tage: Record<string, Day>; offen?: Booking | null; upd: number; aus?: string[] }

export function cleanLedger(v: unknown): Ledger {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>
  const tage: Record<string, Day> = {}
  if (o.tage && typeof o.tage === 'object') for (const [k, d] of Object.entries(o.tage)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) tage[k] = cleanDay(d)
  return {
    tage,
    offen: cleanBooking(o.offen),
    upd: n0(o.upd),
    ...(Array.isArray(o.aus) ? { aus: o.aus.filter((x: unknown) => typeof x === 'string') } : {}),
  }
}

/** Eine Änderung am Tag `at` buchen. */
export function book(l: Ledger, at: number, fn: (d: Day) => void): Ledger {
  const k = dayKey(at)
  const d = cleanDay(l.tage[k])
  fn(d)
  return { ...l, tage: { ...l.tage, [k]: d }, upd: at }
}

export function countWartung(d: Day, id: RuleId, field: 'gezeigt' | 'angenommen') {
  const c = d.wartung[id] ?? { gezeigt: 0, angenommen: 0 }
  c[field] += 1
  d.wartung[id] = c
}

export function countHint(d: Day, art: Art, field: keyof Counts) {
  const c = d.hinweise[art] ?? { gezeigt: 0, angenommen: 0, ignoriert: 0, abgebrochen: 0 }
  c[field] += 1
  d.hinweise[art] = c
}

// ---------- Ersparnis-Buchungen (SPEC Verhalten 8) ----------

/**
 * Offene Buchung im Eintrag der neuen Session nach „Neuer Chat“ (SPEC Verhalten 8). Je Anfrage im neuen Chat:
 * 1. Anfrage: kalt Kontext alt × Schreibpreis, warm Kontext alt × Lesepreis, jeweils − (gelesen × Lesepreis + geschrieben × Schreibpreis).
 * ab der 2.: max(0, Kontext alt − Kontext der 1. Anfrage) × Lesepreis. Beide Chats wachsen danach gleich, der Abstand bleibt.
 * Ende, wenn der neue Chat die alte Größe erreicht, höchstens 50 Anfragen. Die Übergabe steht in den Kosten, nicht hier.
 * `first`: Kontext der 1. Anfrage, 0 bis dahin.
 */
export type Booking = { kind: 'kalt' | 'warm'; oldCtx: number; model: string; ttl: 5 | 60; first: number; steps: number; at: number }

function cleanBooking(v: unknown): Booking | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  if (!o || (o.kind !== 'kalt' && o.kind !== 'warm') || typeof o.oldCtx !== 'number') return null
  return {
    kind: o.kind,
    oldCtx: o.oldCtx,
    model: typeof o.model === 'string' ? o.model : '',
    ttl: o.ttl === 5 ? 5 : 60,
    first: n0(o.first),
    steps: n0(o.steps),
    at: n0(o.at),
  }
}

const MAX_STEPS = 50

/**
 * Eine gemessene Anfrage im neuen Chat: Betrag (kann negativ sein), ob es die erste war, und die Buchung danach (`null` = geschlossen).
 * Eine Buchung aus 0.3 (schon Anfragen, aber kein `first`) nimmt den Kontext der laufenden Anfrage als `first`.
 */
export function bookingStep(b: Booking, u: { total: number; read: number; written: number }): { usd: number; first: boolean; next: Booking | null } {
  const first = b.steps === 0
  const read = priceFor(b.model).read / 1e6
  let usd: number
  let base = b.first
  if (first) {
    const old = b.kind === 'kalt' ? rewriteCost(b.oldCtx, b.model, b.ttl) : b.oldCtx * read
    usd = old - (u.read * read + rewriteCost(u.written, b.model, b.ttl))
    base = u.total
  } else {
    if (!base) base = u.total
    usd = Math.max(0, b.oldCtx - base) * read
  }
  const done = u.total >= b.oldCtx || b.steps + 1 >= MAX_STEPS
  return { usd, first, next: done ? null : { ...b, first: base, steps: b.steps + 1 } }
}

// ---------- Verdichtung (SPEC Zustand) ----------

export const KEEP_DAYS = 7
const AUS_MAX = 1000

/**
 * Plan für die Verdichtung: Einträge `bilanz:<sid>`, die seit `KEEP_DAYS` nicht geschrieben wurden (abgeschlossene Sessions),
 * wandern als Tagessummen nach `bilanz:tage`. Gegen Doppelzählung steht jede verdichtete Session-ID in `aus`; eine zweite,
 * gleichzeitig startende Session überspringt sie. Gelöscht wird eine Quelle erst, wenn ein erneutes Lesen sie in `aus` zeigt
 * (sonst hat eine andere Session `bilanz:tage` überschrieben, und die Quelle wird beim nächsten Start erneut verdichtet).
 */
export function planCompaction(
  tage: Ledger,
  sources: { sid: string; ledger: Ledger }[],
  now: number,
  self: string,
): { next: Ledger; merged: string[] } {
  const aus = new Set(tage.aus ?? [])
  let next: Ledger = { tage: { ...tage.tage }, upd: now, aus: [...aus] }
  const merged: string[] = []
  for (const s of sources) {
    if (s.sid === self || aus.has(s.sid)) continue
    if (now - s.ledger.upd < KEEP_DAYS * 24 * 60 * MIN) continue
    for (const [k, d] of Object.entries(s.ledger.tage)) next.tage[k] = addDay(next.tage[k] ?? emptyDay(), d)
    merged.push(s.sid)
  }
  next = { ...next, aus: [...(next.aus ?? []), ...merged].slice(-AUS_MAX) }
  return { next, merged }
}

// ---------- /savings ----------

export type Period = 'today' | 'week' | 'all'

export function periodOf(arg: string): Period | null {
  const a = arg.trim().toLowerCase()
  if (!a || a === 'week') return 'week'
  if (a === 'today') return 'today'
  if (a === 'all') return 'all'
  return null
}

/** Tage im Zeitraum (lokale Daten): heute, die letzten 7 Tage einschließlich heute, alle. */
function inPeriod(key: string, p: Period, now: number): boolean {
  if (p === 'all') return true
  if (p === 'today') return key === dayKey(now)
  for (let i = 0; i < 7; i++) if (key === dayKey(now - i * 24 * 60 * MIN)) return true
  return false
}

export function sumPeriod(ledgers: Ledger[], p: Period, now: number): Day {
  let s = emptyDay()
  for (const l of ledgers) for (const [k, d] of Object.entries(l.tage)) if (inPeriod(k, p, now)) s = addDay(s, d)
  return s
}

export function periodTitle(p: Period, now: number): string {
  const x = t()
  return p === 'today' ? x.titleToday(shortDate(now)) : p === 'week' ? x.titleWeek(shortDate(now - 6 * 24 * 60 * MIN), shortDate(now)) : x.titleAll
}

/** Sekunden mit einer Nachkommastelle, `–` ohne Messung. */
export const secsText = (ms: number, n: number) => (n > 0 ? `${dec(ms / n / 1000, 1)} s` : '–')

/**
 * Die Markdown-Karte von `/savings` (Befehlsausgaben zeichnet die Engine als Markdown; im Terminal und Desktop ersetzt sie
 * die Zeichnung aus view.ts). `tag` macht den Text eindeutig, damit `ui.render` die passende Zeichnung findet.
 */
export function savingsReport(d: Day, p: Period, now: number, tag = ''): string {
  const x = t()
  const title = periodTitle(p, now)
  const saved = d.kaltVermieden.usd + d.neuWarm.usd
  const ratio = d.kosten > 0 && saved > 0 ? `1 : ${dec(saved / d.kosten, saved / d.kosten >= 10 ? 0 : 1)}` : '–'
  // Die Engine setzt „sidekick: “ davor; deshalb keine Überschrift in der ersten Zeile
  const out = [`**${title}**${tag ? ` · ${tag}` : ''}`, '']
  out.push(x.costLine(usdText(d.kosten), usdText(saved), ratio), '')
  out.push(x.itemsHead, '|---|---|---|---|')
  out.push(x.rowColdAvoided(d.kaltVermieden.n, usdText(d.kaltVermieden.usd)))
  out.push(x.rowWarmNew(d.neuWarm.n, usdText(d.neuWarm.usd)))
  for (const a of ['fassung', 'skill', 'modell'] as const) out.push(x.rowAccepted(x.art[a], d.hinweise[a]?.angenommen ?? 0))
  const mr = modelRows(d)
  if (mr.list.length || mr.earlier.usd) {
    out.push('', x.modelsHead, '|---|---|---|---|---|---|')
    for (const { key, m } of mr.list)
      for (const r of ['pruefung', 'uebergabe'] as const) {
        const u = m[r]
        if (u.n) out.push(`| ${modelLabel(key)} | ${x.role[r]} | ${u.n} | ${usdText(u.usd)} | ${usdText(u.usd / u.n)} | ${secsText(u.ms, u.n)} |`)
      }
    if (mr.earlier.usd) out.push(x.rowEarlier(mr.earlier.n, usdText(mr.earlier.usd)))
  }
  out.push('', x.counts, '')
  out.push(x.checks(d.pruefungen, secsText(d.warteMs, d.pruefungen)))
  const hs = ARTS.filter((a) => d.hinweise[a])
  if (hs.length) {
    out.push('', x.hintsHead, '|---|---|---|---|---|')
    for (const a of hs) {
      const c = d.hinweise[a]!
      out.push(`| ${x.art[a]} | ${c.gezeigt} | ${c.angenommen} | ${c.ignoriert} | ${c.abgebrochen} |`)
    }
    out.push('')
  } else out.push(x.noHints)
  const ws = RULE_IDS.filter((id) => d.wartung[id])
  if (ws.length) {
    out.push('', x.wartungHead, '|---|---|---|')
    for (const id of ws) out.push(`| ${x.rule[id]} | ${d.wartung[id]!.gezeigt} | ${d.wartung[id]!.angenommen} |`)
    out.push('')
  }
  out.push(x.handoffs(d.uebergaben, d.hinweise.modell?.gezeigt ?? 0))
  out.push(x.coldWithout(d.kaltOhne.n, usdText(d.kaltOhne.usd)))
  const sk = Object.entries(d.skills).sort((a, b) => b[1] - a[1])
  out.push(x.skillsUsed(sk.slice(0, 8).map(([k, v]) => `\`${k}\` ${v}×`).join(', ')))
  out.push('', x.savingsFoot)
  return out.join('\n')
}

// ---------- Texte ----------

export function cacheText(kind: string, left: number): string {
  if (kind === 'unknown') return t().cacheUnknown
  if (kind === 'cold') return t().cacheCold(spanText(-left))
  return t().cacheWarm(spanText(left))
}

/** Geschätzte Kosten von „Neuer Chat mit Übergabe“: Das Übergabe-Modell (HANDOFF) liest bis 100 000 Zeichen (Sonnet zählt mehr Tokens
 * je Zeichen als Haiku, Probe: 4,0k statt 2,9k, deshalb 3 Zeichen je Token) und schreibt bis `maxTokens`; dazu schreibt der neue
 * Chat seine Grundlast neu (`base`, gemessen an der letzten Übergabe, sonst 20k). */
export function handoffEstimate(histChars: number, base: number, model: string, ttl: 5 | 60): number {
  const p = priceFor(HANDOFF.model)
  const handoff = (Math.min(histChars, 100000) / 3) * (p.input / 1e6) + HANDOFF.maxTokens * (p.output / 1e6)
  return handoff + rewriteCost(base, model, ttl)
}

// ---------- Empfehlung: was auf Platz 1 steht ----------

export type Choice = 'new' | 'plain' | 'fassung' | 'send' | 'abort'

/**
 * Falscher Chat (Fynn 2026-10-06): Abbrechen auf Platz 1, dann der neue Chat, den `verlauf` nahelegt (ein anderes Gebiet braucht den
 * alten Verlauf meist nicht: ohne Übergabe), dann die andere Variante, zuletzt „trotzdem senden“.
 */
export function wrongChatChoices(resendable: boolean, verlauf?: Verlauf): Choice[] {
  if (!resendable) return ['abort', 'send']
  const best: Choice = verlauf === 'braucht' || verlauf === 'kaum' ? 'new' : 'plain'
  return ['abort', best, best === 'new' ? 'plain' : 'new', 'send']
}

/** Unter diesem Betrag lohnt im Kalt-Fall kein Chatwechsel: neu schreiben ist billig, der Verlauf bleibt. */
const CHEAP_SEND_USD = 0.3

/**
 * Reihenfolge der Antworten, die empfohlene zuerst. Kalt: braucht die Nachricht den Verlauf nicht → ohne Übergabe; ist neu
 * schreiben billig → senden; sonst mit Übergabe. Ohne Urteil der Prüfung zählen nur die Kosten. Warmer Themenwechsel: ohne Übergabe,
 * wenn der Verlauf nicht gebraucht wird, sonst mit. Ohne neuen Chat (Anhang, @datei) steht „senden“ oben.
 */
export function rankChoices(o: { cold: boolean; sendUsd: number; verlauf?: Verlauf; resendable: boolean; fassung: boolean }): Choice[] {
  let first: Choice
  if (!o.resendable) first = 'send'
  else if (o.verlauf === 'nicht') first = 'plain'
  else if (o.cold && o.sendUsd < CHEAP_SEND_USD) first = 'send'
  else first = 'new'
  const all: Choice[] = o.resendable ? ['new', 'plain', 'send', 'abort'] : ['send', 'abort']
  if (o.fassung) all.splice(all.indexOf('send'), 0, 'fassung')
  let list: Choice[] = [first, ...all.filter((x) => x !== first)]
  // Höchstens 4 Antworten (types:2340): zuerst fällt die nicht empfohlene Variante des neuen Chats weg
  if (list.length > 4) list = list.filter((x) => !(x === (first === 'plain' ? 'new' : 'plain')))
  return list.slice(0, 4)
}
