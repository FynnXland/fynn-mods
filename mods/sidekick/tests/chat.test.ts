// Tests zum Ausbau 0.30.0: sidekick-Chat im Seitenfenster und Kreativ-Verweise im Katalog (kind, license 'service', risk.paid,
// install.connectorUrl/composed, MCP-Server aus $.tool.list).
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { dayKey } from '../hooks/cache.js'
import { addDay, bookChat, cleanLedger, countChat, emptyDay, savingsReport } from '../hooks/logic.js'
import type { Ledger } from '../hooks/logic.js'
import { T, setLang, usdText } from '../hooks/i18n.js'
import { savingsTree } from '../hooks/view.js'
import { sidekickHelp } from '../hooks/helpdata.js'
import { CHAT } from '../hooks/models.js'
import { CATALOG, CATALOG_MIN_HEAVY, CATALOG_MIN_PAID, byId, catalogKind, catalogPick, findCandidates, isOpaqueServer, mcpServers, serverMatches, serverState } from '../hooks/catalog.js'
import {
  CHAT_IN_PROMPT,
  CHAT_KEEP,
  CHAT_NARROW,
  CHAT_INPUT_PAD,
  CHAT_ROWS_MAX,
  CHAT_USD_TYPICAL,
  inputRows,
  addTurn,
  cardMeta,
  chatButton,
  chatCard,
  chatPerQuestion,
  chatPrompt,
  chatSystem,
  chatText,
  cleanChat,
  emptyChat,
  offeredIds,
  parseChat,
  skillText,
} from '../hooks/chat.js'
import type { ChatState, ChatTurn } from '../hooks/chat.js'
import { DEFAULT_SETTINGS } from '../hooks/logic.js'

const NOW = new Date(2026, 10, 17, 10, 0, 0).getTime()
const NEW_IDS = ['higgsfield', 'higgsfield-skills', 'fal', 'elevenlabs', 'suno', 'luma', 'video-use', 'yutu', 'marketingskills', 'vidiq', 'canva']
const FAL_DESKTOP = 'e610e383-d419-4c41-a077-93cb8d6251db'

function deTest(name: string, a: Record<string, string | number | boolean> | (($: Engine, on: On) => unknown), b?: ($: Engine, on: On) => unknown) {
  const cfg = typeof a === 'function' ? {} : a
  const body = typeof a === 'function' ? a : b!
  test(name, { options: { language: 'de', ...cfg } }, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}

// ---------- Katalog-Daten (Ausbau 0.30.0) ----------

test('0.30.0 Daten: kind überall, neue Einträge, service ohne Repo, paid → nur Zeile, composed nur bei mcp/connector, URLs https', () => {
  for (const c of CATALOG) expect(['skill', 'plugin', 'mcp', 'connector']).toContain(c.kind)
  for (const id of NEW_IDS) expect(byId(id)?.way).toBe('reference')
  // Verworfen (E6): Postiz ohne Lizenz
  expect(byId('postiz')).toBeUndefined()
  for (const c of CATALOG) {
    if (c.license === 'service') {
      expect(c.repo).toBe('')
      expect(['mcp', 'connector']).toContain(c.kind)
    }
    if (c.risk.paid) {
      // E4: hält nie an
      expect(catalogKind(c)).toBe('line')
      expect(c.way).toBe('reference')
    }
    if (c.install?.composed) {
      expect(['mcp', 'connector']).toContain(c.kind)
      const url = c.install.connectorUrl!
      expect(url.startsWith('https://')).toBe(true)
      // E5: Syntax der fal-Doku mit der URL des Herstellers
      expect(c.install.line).toBe(`claude mcp add --transport http --scope user ${c.id} ${url}`)
    }
    if (c.install?.connectorUrl) expect(/^https:\/\/[^\s]+$/.test(c.install.connectorUrl)).toBe(true)
  }
  expect(CATALOG.filter((c) => c.install?.composed).map((c) => c.id).sort()).toEqual(['elevenlabs', 'higgsfield', 'luma', 'vidiq'])
  // Wörtlich aus der Anleitung des Herstellers, nicht zusammengesetzt
  expect(byId('fal')!.install).toEqual({ line: 'claude mcp add --transport http --scope user fal https://mcp.fal.ai/mcp-relay' })
  expect(byId('suno')!.install).toEqual({ line: 'claude mcp add --transport http suno https://api.suno.com/mcp' })
  expect(byId('luma')!.install?.connectorUrl).toBe('https://agents.lumalabs.ai/mcp')
  expect(byId('yutu')!.install?.line).toBe('npx skills add eat-pray-ai/yutu --skill youtube-automation')
  // video-use hat keine Zeile, nur die Adresse (README:28-33)
  expect(byId('video-use')!.install).toBeUndefined()
  expect(catalogKind(byId('video-use')!)).toBe('line')
  // Ohne Kosten: Rückfrage mit Befehl wie die anderen leichten Verweise
  for (const id of ['yutu', 'marketingskills', 'canva']) expect(catalogKind(byId(id)!)).toBe('copy')
  expect(CATALOG.filter((c) => c.risk.paid).map((c) => c.id).sort()).toEqual(['elevenlabs', 'fal', 'higgsfield', 'higgsfield-skills', 'luma', 'suno', 'vidiq'])
  // Lizenzen der Repos (GitHub-API 2026-11-17)
  expect(byId('higgsfield-skills')!.license).toBe('MIT')
  expect(byId('yutu')!.license).toBe('Apache-2.0')
  expect(byId('canva')!.license).toBe('Apache-2.0')
})

test('0.30.0 Urteil: paid erst ab CATALOG_MIN_PAID (0,85, Fynn 2026-11-17), schwer weiter ab 0,9', () => {
  expect(CATALOG_MIN_PAID).toBe(0.85)
  expect(CATALOG_MIN_HEAVY).toBe(0.9)
  const suno = byId('suno')!
  expect(catalogPick({ id: 'suno', sicher: 0.84, grund: 'x' }, [suno])).toBeNull()
  expect(catalogPick({ id: 'suno', sicher: 0.85, grund: 'x' }, [suno])).toBe(suno)
  // video-use ist schwer, nicht kostenpflichtig: 0,85 reicht nicht
  const vu = byId('video-use')!
  expect(catalogPick({ id: 'video-use', sicher: 0.85, grund: 'x' }, [vu])).toBeNull()
  expect(catalogPick({ id: 'video-use', sicher: 0.9, grund: 'x' }, [vu])).toBe(vu)
  // ohne Kosten weiter ab 0,7
  const yutu = byId('yutu')!
  expect(catalogPick({ id: 'yutu', sicher: 0.75, grund: 'x' }, [yutu])).toBe(yutu)
})

test('0.30.0 Probe P1: Servernamen aus $.tool.list, Präfixe claude_ai_ und plugin_, UUID im Desktop', () => {
  const tools = [
    { name: 'mcp__claude_ai_fal_Bilder_Videos__run_model', description: '', mcp: true },
    { name: 'mcp__claude_ai_fal_Bilder_Videos__submit_job', description: '', mcp: true },
    { name: 'mcp__earshot__describe', description: '', mcp: true },
    { name: 'mcp__plugin_todo-feed_todo__todo_add', description: '', mcp: true },
    { name: 'Bash', description: '', mcp: false },
  ]
  expect(mcpServers(tools)).toEqual(['claude_ai_fal_Bilder_Videos', 'earshot', 'plugin_todo-feed_todo'])
  expect(serverMatches('claude_ai_fal_Bilder_Videos', 'fal')).toBe(true)
  expect(serverMatches('fal', 'fal')).toBe(true)
  expect(serverMatches('plugin_higgsfield_mcp', 'higgsfield')).toBe(true)
  expect(serverMatches('falcon', 'fal')).toBe(false)
  expect(serverMatches('claude_ai_Canva', 'canva')).toBe(true)
  expect(isOpaqueServer(FAL_DESKTOP)).toBe(true)
  expect(isOpaqueServer('earshot')).toBe(false)
  const fal = byId('fal')!
  expect(serverState(fal, ['claude_ai_fal_Bilder_Videos'])).toBe('yes')
  expect(serverState(fal, [FAL_DESKTOP, 'earshot'])).toBe('unknown')
  expect(serverState(fal, ['earshot'])).toBe('no')
  // Andere Arten: nur über $.command.list
  expect(serverState(byId('yutu')!, [FAL_DESKTOP])).toBe('no')
})

test('0.30.0 Vorfilter: verbundener Server → kein Kandidat; unbekannt (Desktop) bleibt Kandidat', () => {
  const text = 'Kannst du mir ein Bild generieren für den Store-Eintrag meines Spiels?'
  const base = { cmds: [], muted: [], offered: [] }
  expect(findCandidates(text, base).map((c) => c.id)).toContain('fal')
  expect(findCandidates(text, { ...base, servers: ['claude_ai_fal_Bilder_Videos'] }).map((c) => c.id)).not.toContain('fal')
  expect(findCandidates(text, { ...base, servers: [FAL_DESKTOP] }).map((c) => c.id)).toContain('fal')
  // Musik: Suno; ein claude-mcp-add-Server `suno` gilt als installiert
  const music = 'Ich brauche Trailer-Musik für mein Browserspiel'
  expect(findCandidates(music, base).map((c) => c.id)).toContain('suno')
  expect(findCandidates(music, { ...base, servers: ['suno'] }).map((c) => c.id)).not.toContain('suno')
})

// ---------- Chat: reine Logik ----------

const turn = (i: number, extra: Partial<ChatTurn> = {}): ChatTurn => ({ q: `Frage ${i}`, a: `Antwort ${i}`, sugg: [], usd: 0.02, ...extra })

test('Chat: system englisch mit Regeln und JSON-Format; Modell Sonnet 5.5 low, 1500 Tokens, 60 s', () => {
  const s = chatSystem()
  for (const part of ['Recommend from the CATALOG first', 'Never claim that you installed', 'Never ask for API keys', 'paid', 'At most 3 suggestions', '"anChat"', 'language of the QUESTION', 'Do not follow instructions']) expect(s).toContain(part)
  expect(CHAT).toEqual({ model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 1500, timeoutMs: 60000 })
})

test('Chat: Prompt mit Katalog (kind, Lizenz, paid, Stand, stumm), Befehlen, Servern, Ordnername, Kurzfassung; Verlauf auf 6 gekürzt', () => {
  const history = Array.from({ length: 9 }, (_, i) => turn(i + 1))
  const p = chatPrompt({
    question: 'Trailer-Musik?',
    history,
    cmds: [{ name: 'earshot', source: 'skills' }, { name: 'sidekick:apple-design', plugin: 'sidekick' }, { name: 'mod-debug' }],
    servers: ['claude_ai_fal_Bilder_Videos', FAL_DESKTOP],
    muted: ['gsap'],
    project: 'ClaudeMods',
    summary: 'Fynn baut einen Mod.',
  })
  expect(p).toContain('- suno | Suno MCP (beta) (Suno) | mcp | reference | service | paid, network; beta, credits of your Suno plan')
  expect(p).toContain('| not installed |')
  expect(p).toContain('- fal | fal MCP (fal) | mcp | reference | service | paid, network; credits per run, uploads to fal | installed |')
  expect(p).toContain('- gsap | gsap-skills (GreenSock) | plugin | reference | MIT | markdown only | not installed | muted |')
  expect(p).toContain('ships with sidekick (≈ 5800 tokens)')
  // eigene Kopien nicht doppelt in den Befehlen
  expect(p).toContain('/earshot, /mod-debug')
  expect(p).not.toContain('/sidekick:apple-design')
  expect(p).toContain('claude_ai_fal_Bilder_Videos, 1 connector of unknown name')
  expect(p).toContain('[PROJECT FOLDER] ClaudeMods [/PROJECT FOLDER]')
  expect(p).toContain('Fynn baut einen Mod.')
  // letzte 6 (4–9), nicht 1–3
  expect(p).toContain('Q: Frage 4')
  expect(p).toContain('Q: Frage 9')
  expect(p).not.toContain('Q: Frage 3')
  expect(CHAT_IN_PROMPT).toBe(6)
  expect(p.trim().endsWith('[QUESTION]\nTrailer-Musik?\n[/QUESTION]')).toBe(true)
})

test('Chat: Verlauf höchstens 10, fremde Sitzung (nach /clear) leer, busy fällt mit dem nächsten Wechsel weg', () => {
  let s: ChatState = { ...emptyChat('s1'), busy: { q: 'x' } }
  for (let i = 0; i < 12; i++) s = addTurn(s, turn(i))
  expect(s.turns.length).toBe(CHAT_KEEP)
  expect(s.turns[0]!.q).toBe('Frage 2')
  expect(s.n).toBe(12)
  expect(Math.round(s.usd * 100) / 100).toBe(0.24)
  expect('busy' in s).toBe(false)
  expect(cleanChat(s, 's1').turns.length).toBe(10)
  expect(cleanChat(s, 's2')).toEqual(emptyChat('s2'))
  expect(cleanChat('kaputt', 's1')).toEqual(emptyChat('s1'))
})

test('Chat: Antwort lesen; ungültig → null; nur bekannte ids und Befehle, höchstens 3, ohne Doppelte; Längen gekürzt', () => {
  const cmds = [{ name: 'mod-debug' }, { name: 'remotion:remotion-create', plugin: 'remotion' }]
  const raw = '```json\n' + JSON.stringify({
    antwort: 'A'.repeat(1500),
    vorschlaege: [{ id: 'suno', warum: 'Musik' }, { id: 'erfunden', warum: 'x' }, { id: '/mod-debug', warum: 'Debug' }, { id: 'suno', warum: 'doppelt' }, { id: 'remotion:remotion-create', warum: 'Video' }, { id: 'gsap', warum: 'vierter' }],
    anChat: 'B'.repeat(700),
  }) + '\n```'
  const a = parseChat(raw, cmds)!
  expect(a.antwort.length <= 1200).toBe(true)
  expect(a.vorschlaege.map((v) => v.id)).toEqual(['suno', 'mod-debug', 'remotion:remotion-create'])
  expect(a.anChat!.length <= 600).toBe(true)
  expect(parseChat('kein json', cmds)).toBeNull()
  expect(parseChat('{"vorschlaege":[]}', cmds)).toBeNull()
  expect(parseChat('{"antwort":"ok"}', cmds)).toEqual({ antwort: 'ok', vorschlaege: [] })
  expect(offeredIds([{ id: 'suno', warum: '' }, { id: 'mod-debug', warum: '' }])).toEqual(['suno'])
  expect(skillText(turn(1, { draft: 'Entwurf' }))).toBe('Entwurf')
  expect(skillText(turn(1))).toBe('Frage 1')
})

test('Chat: Knopf je Art (mitgeliefert, Zeile, URL im Desktop, Befehl, installiert, nur Adresse)', () => {
  const o = { cmds: [{ name: 'mod-debug' }, { name: 'gsap-skills:gsap-core', plugin: 'gsap-skills' }], servers: [] as string[], surface: 'terminal' }
  expect(chatButton({ id: 'emil-apple', warum: '' }, o)).toMatchObject({ art: 'skill' })
  expect(chatButton({ id: 'suno', warum: '' }, o)).toMatchObject({ art: 'copy', line: 'claude mcp add --transport http suno https://api.suno.com/mcp' })
  expect(chatButton({ id: 'higgsfield', warum: '' }, o)).toMatchObject({ art: 'copy', line: 'claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp' })
  expect(chatButton({ id: 'higgsfield', warum: '' }, { ...o, surface: 'desktop' })).toMatchObject({ art: 'url', url: 'https://mcp.higgsfield.ai/mcp' })
  expect(chatButton({ id: 'mod-debug', warum: '' }, o)).toEqual({ art: 'cmd', cmd: 'mod-debug' })
  // sp-debug tritt hinter /mod-debug zurück (0.28.0 E5): Befehl statt Skill
  expect(chatButton({ id: 'sp-debug', warum: '' }, o)).toEqual({ art: 'cmd', cmd: 'mod-debug' })
  expect(chatButton({ id: 'gsap', warum: '' }, o)).toBeNull()
  expect(chatButton({ id: 'fal', warum: '' }, { ...o, servers: ['claude_ai_fal_Bilder_Videos'] })).toBeNull()
  expect(chatButton({ id: 'video-use', warum: '' }, o)).toBeNull()
  expect(chatButton({ id: 'nix', warum: '' }, o)).toBeNull()
})

test('0.31.1 Zeile eines Vorschlags: Name, Art · Lizenz · Stand, kostenpflichtig, Grund; Stand folgt dem Knopf (de/en)', () => {
  const o = { cmds: [{ name: 'mod-debug' }, { name: 'gsap-skills:gsap-core', plugin: 'gsap-skills' }], servers: [] as string[], surface: 'desktop' }
  const de = { ...T.de.chat, service: T.de.cat.service }
  const tok = (n: number) => `${n}`
  const meta = (id: string, ctx = o, x = de) => cardMeta(chatCard({ id, warum: 'weil' }, ctx), x, tok)
  // mitgeliefert: Tokens stehen in der Zeile, nicht mehr auf dem Knopf
  const apple = chatCard({ id: 'emil-apple', warum: 'Apple-Look' }, o)
  expect(apple).toMatchObject({ name: 'apple-design', kind: 'skill', license: 'MIT', state: 'bundled', paid: false, why: 'Apple-Look' })
  expect(apple.button).toMatchObject({ art: 'skill' })
  expect(meta('emil-apple')).toBe(`Skill · MIT · liegt bei, ≈ ${byId('emil-apple')!.ctxTokens} Tokens Kontext`)
  // Dienst: kostenpflichtig ist ein eigenes Feld (das Fenster schreibt das Wort aus), Lizenz „Dienst“
  expect(chatCard({ id: 'higgsfield', warum: '' }, o)).toMatchObject({ name: 'Higgsfield MCP', paid: true, state: 'missing' })
  expect(meta('higgsfield')).toBe('Connector · Dienst · nicht verbunden')
  expect(meta('fal', { ...o, servers: ['claude_ai_fal_Bilder_Videos'] })).toContain('· verbunden')
  // Desktop-Connector mit UUID: Stand unbekannt, der Knopf bleibt
  expect(meta('fal', { ...o, servers: [FAL_DESKTOP] })).toContain(T.de.chat.stUnknown)
  // installiertes Plugin: kein Knopf, aber die Zeile bleibt
  expect(chatCard({ id: 'gsap', warum: '' }, o)).toMatchObject({ state: 'installed', button: null })
  expect(meta('gsap')).toContain('· installiert')
  // installiertes Original: der Befehl, den der Knopf startet, steht im Text
  const sp = { ...o, cmds: [{ name: 'superpowers:systematic-debugging', plugin: 'superpowers', source: 'plugin' }] }
  expect(chatCard({ id: 'sp-debug', warum: '' }, sp)).toMatchObject({ state: 'run', cmd: 'superpowers:systematic-debugging' })
  expect(meta('sp-debug', sp)).toContain('installiert, startet /superpowers:systematic-debugging')
  // Projekt-Befehl hat Vorrang (0.28.0 E5)
  expect(chatCard({ id: 'sp-debug', warum: '' }, o)).toMatchObject({ state: 'yielded', cmd: 'mod-debug' })
  expect(meta('sp-debug')).toContain('in diesem Projekt besser /mod-debug')
  expect(meta('sp-debug', { ...o, cmds: [] })).toContain('· nicht installiert')
  // Befehl außerhalb des Katalogs; nach einem Neuladen (keine Befehlsliste, K9) ohne Stand und ohne Knopf
  expect(chatCard({ id: 'mod-debug', warum: 'Projekt' }, o)).toMatchObject({ name: '/mod-debug', kind: 'command', state: 'installed', why: 'Projekt' })
  expect(meta('mod-debug')).toBe('Befehl · installiert')
  expect(chatCard({ id: 'mod-debug', warum: '' }, { ...o, cmds: [] })).toMatchObject({ name: '/mod-debug', button: null })
  expect(meta('mod-debug', { ...o, cmds: [] })).toBe('Befehl')
  // Review 0.31.1 S1: Befehle und Server nicht gelesen (nach einem Neuladen) → kein Stand statt „nicht installiert“; der Knopf bleibt (K9)
  const blind = { cmds: [], servers: [] as string[], surface: 'desktop', known: false }
  expect(chatCard({ id: 'sp-debug', warum: '' }, blind).state).toBeUndefined()
  expect(meta('sp-debug', blind)).toBe('Skill · MIT')
  expect(meta('fal', blind)).not.toContain(T.de.chat.stNotConnected)
  expect(chatCard({ id: 'sp-debug', warum: '' }, blind).button).toMatchObject({ art: 'copy' })
  // Review K1: ohne Zeile zum Kopieren (video-use) nennt die Zeile die Quelle; mit Knopf nicht
  expect(chatCard({ id: 'video-use', warum: '' }, o)).toMatchObject({ state: 'missing', button: null, url: byId('video-use')!.url })
  expect(chatCard({ id: 'suno', warum: '' }, o).url).toBeUndefined()
  // Review S2: Kosten je Frage aus den beantworteten Wechseln; Fehler ohne Kosten zählen nicht, ohne Antwort der übliche Wert
  const t = (usd: number, err?: 'failed'): ChatTurn => ({ q: 'q', a: err ? '' : 'a', sugg: [], usd, ...(err ? { err } : {}) })
  expect(chatPerQuestion([])).toBe(CHAT_USD_TYPICAL)
  expect(chatPerQuestion([t(0, 'failed')])).toBe(CHAT_USD_TYPICAL)
  expect(Math.abs(chatPerQuestion([t(0.02), t(0, 'failed'), t(0.04)]) - 0.03) < 1e-9).toBe(true)
  // Englisch
  expect(T.en.chat.stYielded('mod-debug')).toBe('this project has /mod-debug for that')
  expect(meta('higgsfield', o, { ...T.en.chat, service: T.en.cat.service })).toBe(`Connector · ${T.en.cat.service} · not connected`)
  expect(Object.keys(T.en.chat.kinds).sort()).toEqual(Object.keys(T.de.chat.kinds).sort())
  expect(T.en.chat.examples.length).toBe(T.de.chat.examples.length)
})

test('Chat: Text für -p mit Vorschlägen und Entwurf', () => {
  const s = chatText(
    { antwort: 'Nimm Suno.', vorschlaege: [{ id: 'suno', warum: 'Musik' }, { id: 'mod-debug', warum: 'Fehler' }], anChat: 'Bitte X.' },
    { cmds: [{ name: 'mod-debug' }], servers: [], head: 'Vorschläge', draftHead: 'Entwurf für den Chat', service: 'Dienst' },
  )
  expect(s).toBe(
    'Nimm Suno.\n\n**Vorschläge**\n- **Suno MCP (beta) (Suno, Dienst)**: Musik · `claude mcp add --transport http suno https://api.suno.com/mcp`\n- **/mod-debug**: Fehler · `/mod-debug`\n\n**Entwurf für den Chat**\n\nBitte X.',
  )
})

test('Chat: Bilanz Rolle „Chat“ in /savings detail (de/en) und in der Zeichnung', () => {
  const d = emptyDay()
  bookChat(d, CHAT.model, 0.025, 5000)
  bookChat(d, CHAT.model, 0.02, 4000)
  countChat(d, 'fehler')
  countChat(d, 'skill')
  countChat(d, 'kopiert')
  countChat(d, 'url')
  countChat(d, 'entwurf')
  expect(d.chat).toMatchObject({ n: 2, fehler: 1, skill: 1, kopiert: 1, url: 1, entwurf: 1 })
  expect(d.modelle[CHAT.model]!.chat.n).toBe(2)
  setLang('de')
  const days = { [dayKey(NOW)]: d }
  const md = savingsReport(d, 'all', NOW, '', days)
  expect(md).toContain('| Sonnet 5.5 | Chat | 2 |')
  expect(md).toContain('Chat: 2 Fragen (')
  expect(md).toContain('1 ohne Antwort, 1× mit Skill gesendet, 2× kopiert, 0× Befehl genutzt, 1× Entwurf übernommen')
  expect(JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal', days))).toContain('Chat: 2 Fragen')
  expect(savingsReport(emptyDay(), 'all', NOW, '', { [dayKey(NOW)]: emptyDay() })).not.toContain('Chat: ')
  setLang('en')
  expect(savingsReport(d, 'all', NOW, '', days)).toContain('Chat: 2 questions (')
  setLang('de')
  // Zusammenführen über Tage, alte Tage ohne Feld
  expect(addDay(d, d).chat.n).toBe(4)
  expect(cleanLedger({ tage: { [dayKey(NOW)]: { kosten: 1 } } }).tage[dayKey(NOW)]!.chat).toEqual({ n: 0, usd: 0, ms: 0, fehler: 0, skill: 0, kopiert: 0, url: 0, befehl: 0, entwurf: 0 })
  expect(Object.keys(T.en.chat).sort()).toEqual(Object.keys(T.de.chat).sort())
  expect(T.de.role.chat).toBe('Chat')
})

test('Chat: Hilfe nennt /sidekick chat (de/en)', () => {
  const facts = { settings: DEFAULT_SETTINGS, ttl: { min: 60, source: 'default' as const }, hints: { on: true, off: [] }, known: 0, now: NOW }
  setLang('de')
  expect(JSON.stringify(sidekickHelp(facts))).toContain('/sidekick chat [<frage>]')
  setLang('en')
  expect(JSON.stringify(sidekickHelp(facts))).toContain('/sidekick chat [<question>]')
  expect(JSON.stringify(sidekickHelp(facts))).toContain(T.en.help.chat)
  setLang('de')
})

// ---------- Hooks ----------

type Reply = string | Error | { reason: 'aborted' | 'api-error' | 'empty-reply'; status?: number }
const U = { input_tokens: 9000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ANSWER = JSON.stringify({
  antwort: 'Für Shorts: **Remotion** ist da; für Musik **Suno** (Credits).',
  vorschlaege: [
    { id: 'suno', warum: 'Trailer-Musik' },
    { id: 'emil-apple', warum: 'Apple-Look' },
    { id: 'higgsfield', warum: 'Clips' },
  ],
  anChat: 'Bau mir ein Shorts-Template mit Remotion.',
})

function world(on: On, o: { surfaces?: string[]; cmds?: { name: string; plugin?: string; source?: string }[]; servers?: string[]; placed?: boolean; box?: string; catReply?: string; runFails?: boolean; toolsFail?: boolean; copyFails?: boolean; closeDeny?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  const state = new Map<string, unknown>()
  const toasts: string[] = []
  const copies: string[] = []
  const fills: string[] = []
  const opens: unknown[] = []
  const submits: { text: string; context?: readonly string[]; origin?: unknown }[] = []
  const chats: { system: string; prompt: string; signal?: unknown }[] = []
  const asks: string[] = []
  const runs: { command: string; args?: string }[] = []
  let answer: string | null = null
  let reply: Reply = ANSWER
  let sid = 'sess-1'
  let hold: Promise<void> | null = null
  const surfaces = o.surfaces ?? ['desktop']
  on('session.start', () => ({ cwd: '/work' }) as never)
  on('session.id', () => ({ value: sid }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: surfaces as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 20000, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'E:\\Entwicklung\\06_Spiele\\Wuerfelspiel' }))
  // Mit Antwort im Verlauf: nicht die erste Nachricht (sonst Auslöser a der Prüfung, dann kämen die Kandidaten in deren Aufruf)
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Bau bitte den Export in das Menü ein', toolUses: [] }, { role: 'assistant', text: 'Erledigt.', toolUses: [] }] as never }))
  let catCalls = 0
  on('command.list', () => ({ value: (o.cmds ?? []).map((c) => ({ description: '', source: 'plugin', ...c })) as never }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('tool.list', () => {
    if (o.toolsFail) throw new Error('tool.list down')
    return { value: [...(o.servers ?? []).map((s) => ({ name: `mcp__${s}__x`, description: '', mcp: true })), { name: 'Bash', description: '', mcp: false }] as never }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('state.get', ($, e) => ({ value: { value: state.get(`${e.plugin}.${e.key}`), version: 1 } as never }))
  on('state.set', ($, e) => {
    state.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  // Nachtrag 0.32.0: offene Fenster für den Knopf „Chat“ (auf/zu)
  const up = new Set<string>()
  const closes: unknown[] = []
  let placed = o.placed !== false
  on('ui.open', ($, e) => {
    opens.push(e)
    if (placed) up.add(e.id)
    return { value: (placed ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' }) as never }
  })
  on('ui.panes', () => ({ value: [...up].map((id) => ({ id, title: 'sidekick', isShown: true, isFocused: true, isPlaced: true })) as never }))
  on('ui.close', ($, e) => {
    closes.push(e)
    if (o.closeDeny) return { deny: 'offen lassen' } as never
    up.delete(e.id)
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: (o.copyFails ? { isCopied: false, reason: 'no-clipboard' } : { isCopied: true }) as never }
  })
  on('prompt.read', () => ({ value: { text: o.box ?? '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return (surfaces.includes('desktop') ? { isFilled: false, refusal: 'no_composer' } : { isFilled: true }) as never
  })
  on('command.run', ($, e) => {
    runs.push({ command: e.command, args: e.args })
    if (o.runFails) throw new Error('no session')
    return {} as never
  })
  on('fs.read', () => ({ value: '---\nname: apple-design\ndisable-model-invocation: true\n---\n\n# Apple Design\nSKILL-BODY $ARGUMENTS' }))
  on('tool.call', async ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]!
    asks.push(q.question)
    if (answer === null) return { deny: 'Dialog geschlossen' }
    return { result: { answers: { [q.question]: answer } } }
  })
  on('model.complete', async ($, e, x) => {
    const sys = e.system ?? ''
    if (sys.includes('A keyword filter') || sys.includes('Ein Stichwortfilter')) {
      catCalls++
      return { value: { isAnswered: true, text: o.catReply ?? '{"id":"none","sicher":0}', usage: U } as never }
    }
    if (!sys.includes("sidekick's advisor")) return { value: { isAnswered: true, text: '{"urteil":"durch","art":"sonstiges","zeile":"","fassung":"","skill":"","kurzfassung":"k"}', usage: U } as never }
    chats.push({ system: sys, prompt: e.prompt })
    if (hold) await hold
    const r = reply
    if (r instanceof Error) throw r
    if (typeof r === 'object') return { value: { isAnswered: false, ...r, ...(r.reason === 'api-error' ? { status: r.status ?? 500 } : {}), usage: U } as never }
    return { value: { isAnswered: true, text: r, usage: U } as never }
  })
  on('prompt.submit', async ($, e) => {
    submits.push({ text: e.text, ...(e.context ? { context: e.context } : {}), origin: e.origin })
    return { text: e.text, ...(e.context ? { context: e.context } : {}) }
  })
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
  return {
    clock,
    store,
    state,
    toasts,
    copies,
    fills,
    opens,
    closes,
    setPlaced: (v: boolean) => (placed = v),
    submits,
    chats,
    asks,
    runs,
    setReply: (r: Reply) => (reply = r),
    setAnswer: (a: string | null) => (answer = a),
    setSid: (s: string) => (sid = s),
    holdOn: () => {
      let release = () => {}
      hold = new Promise<void>((r) => (release = r))
      return () => {
        hold = null
        release()
      }
    },
    chat: () => state.get('sidekick.chat') as { sid: string; turns: ChatTurn[]; n: number; usd: number; busy?: { q: string } } | undefined,
    catCalls: () => catCalls,
    ledger: () => cleanLedger(store.get(`bilanz:${sid}`)),
  }
}

async function flush(rounds = 400) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
const today = (l: Ledger) => l.tage[dayKey(NOW)] ?? emptyDay()
const run = async ($: Engine, args: string) => await $.command.run({ command: 'sidekick', args, origin: { kind: 'composer' } } as never)
async function start($: Engine, surface = 'desktop') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' } as never)
  await flush()
}
async function pane($: Engine, surface = 'desktop') {
  return $.ui.mount({ plugin: 'sidekick', component: 'Pane', requestId: 'sidekick-chat', surface, props: { title: 'sidekick', isFocused: true, bodyColumns: 70, placement: 'dock' } } as never)
}
const X = T.de.chat

deTest('/sidekick chat öffnet das Fenster (Fokus, Escape schließt), ohne Ausgabe; Fenster: Kopf, Hinweis, Eingabefeld', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await run($, 'chat')
  expect(r.text).toBeUndefined()
  expect(w.opens).toEqual([{ id: 'sidekick-chat', title: 'sidekick', focus: true, closeOnEscape: true }])
  const ui = await pane($)
  const all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.head)
  expect(all).toContain(X.empty)
  const input = await ui.find({ key: 'ask' })
  expect(JSON.stringify(input)).toContain(X.placeholder)
  // Nachtrag 0.32.0: einzeilig, wächst beim Tippen (bis 0.31.2: rows 2); volle Breite über die Hülle
  expect(JSON.stringify(input)).toContain('"rows":1')
  expect((await ui.find({ key: 'sidekick-chat-ask' }) as { props: Record<string, unknown> }).props).toMatchObject({ width: 70, alignItems: 'stretch' })
  // Nachtrag 0.31.1: Modell im Kopf, Überschrift, Beispielfragen als Knöpfe; noch keine Kosten im Kopf
  expect(all).toContain(`${X.head} · Sonnet 5.5`)
  expect(all).toContain(X.emptyHead)
  expect(all).not.toContain(X.cost('≈ 0 $', 0))
  for (let i = 0; i < X.examples.length; i++) expect(JSON.stringify(await ui.find({ key: `sidekick-chat-ex-${i}` }))).toContain(X.examples[i]!.label)
  expect(w.chats.length).toBe(0)
  await ui.unmount()
})

deTest('Frage im Fenster: Kontext an Sonnet, keine Dateien; Antwort, Knöpfe, Kosten im Kopf; angeboten im Haupt-Chat', async ($, on) => {
  const w = world(on, { servers: ['claude_ai_Epidemic_Sound'] })
  await start($)
  await run($, 'chat')
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Ich will Shorts zu meinem Spiel machen, was brauche ich?' })
  await flush()
  expect(w.chats.length).toBe(1)
  const p = w.chats[0]!.prompt
  expect(p).toContain('[PROJECT FOLDER] Wuerfelspiel [/PROJECT FOLDER]')
  expect(p).toContain('claude_ai_Epidemic_Sound')
  expect(p).toContain('Ich will Shorts zu meinem Spiel machen')
  expect(p).not.toContain('E:\\Entwicklung')
  const s = w.chat()!
  expect(s.sid).toBe('sess-1')
  expect(s.turns.length).toBe(1)
  expect(s.turns[0]!.sugg.map((x) => x.id)).toEqual(['suno', 'emil-apple', 'higgsfield'])
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(all).toContain('Für Shorts: **Remotion** ist da')
  // Nachtrag 0.31.1: der Name steht in der Zeile, der Knopf trägt nur die Aktion
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-0' }))).toContain(`"label":"${X.btnCopy}"`)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-1' }))).toContain(`"label":"${X.btnSkill}"`)
  // Desktop: URL statt Zeile
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-2' }))).toContain(`"label":"${X.btnUrl}"`)
  for (const s of ['Suno MCP (beta)', 'apple-design', 'Higgsfield MCP', 'Trailer-Musik', 'Apple-Look', 'Clips']) expect(all).toContain(s)
  expect(all).toContain('Skill · MIT · liegt bei, ≈ 5,8k Tokens Kontext')
  expect(all).toContain('Connector · Dienst · nicht verbunden')
  expect(all).toContain(X.paid)
  expect(all).toContain(X.btnDraft)
  // Hauptknopf nur einmal: der Entwurf (es gibt einen), kein Vorschlag
  expect(all.split('"variant":"primary"').length - 1).toBe(1)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-draft' }))).toContain('"variant":"primary"')
  expect(all).toContain('1 Frage · ')
  expect(all).toContain(`${X.enterSends} · `)
  // Bilanz Rolle „Chat“
  expect(today(w.ledger()).chat.n).toBe(1)
  expect(today(w.ledger()).chat.usd > 0).toBe(true)
  // Verhalten 4: die Vorschläge gelten als angeboten, der Vorfilter fragt im Haupt-Chat nicht noch einmal (Sitzung im Store)
  const ses = w.store.get('sitzung:sess-1') as { catOffered: string[] }
  expect(ses.catOffered).toEqual(['suno', 'emil-apple', 'higgsfield'])
  await ui.unmount()
})

deTest('/sidekick chat <frage> stellt die Frage sofort; zweite Frage während der Antwort wird abgewiesen; Abbrechen', async ($, on) => {
  const w = world(on)
  await start($)
  const release = w.holdOn()
  await run($, 'chat Trailer-Musik?')
  await flush(3000)
  expect(w.chats.length).toBe(1)
  expect(w.chat()!.busy).toEqual({ q: 'Trailer-Musik?' })
  const ui = await pane($)
  let all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.thinking)
  expect(all).toContain(X.usual)
  // Die Frage steht während des Wartens im Rahmen, rechts
  expect(all).toContain('"justifyContent":"flex-end"')
  expect(all).toContain('"children":["Trailer-Musik?"]')
  expect(all).not.toContain(X.emptyHead)
  await ui.input({ key: 'ask', text: 'Noch was' })
  await flush()
  expect(w.toasts).toContain(X.busy)
  expect(w.chats.length).toBe(1)
  // Abbrechen: das Modell meldet aborted, das eigene Signal ist abgebrochen
  w.setReply({ reason: 'aborted' })
  await ui.press({ key: 'sidekick-chat-cancel' })
  release()
  await flush()
  const s = w.chat()!
  expect(s.busy).toBeUndefined()
  expect(s.turns[0]).toMatchObject({ q: 'Trailer-Musik?', err: 'aborted' })
  await ui.redraw()
  all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.aborted)
  expect(all).not.toContain(X.thinking)
  expect(today(w.ledger()).chat.fehler).toBe(1)
  await ui.unmount()
})

deTest('Fehler, Timeout, ungültiges JSON: kurze Zeile bzw. Text ohne Knöpfe', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  w.setReply({ reason: 'api-error', status: 529 })
  await ui.input({ key: 'ask', text: 'eins' })
  await flush()
  w.setReply({ reason: 'aborted' })
  await ui.input({ key: 'ask', text: 'zwei' })
  await flush()
  w.setReply(new Error('kein Netz'))
  await ui.input({ key: 'ask', text: 'drei' })
  await flush()
  w.setReply('Nimm einfach Suno, das passt.')
  await ui.input({ key: 'ask', text: 'vier' })
  await flush()
  const s = w.chat()!
  expect(s.turns.map((t) => t.err ?? (t.raw ? 'raw' : 'ok'))).toEqual(['failed', 'timeout', 'failed', 'raw'])
  expect(s.turns[0]!.why).toBe('HTTP 529')
  // Der Test-Host meldet eine Ausnahme des Mocks als eigenen Fehlertext: nur, dass es einen Grund gibt
  expect(!!s.turns[2]!.why).toBe(true)
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.failed('HTTP 529'))
  expect(all).toContain(X.timeout)
  expect(all).toContain('Nimm einfach Suno, das passt.')
  expect(await ui.find({ key: 'sidekick-chat-3-0' })).toBeUndefined()
  expect(today(w.ledger()).chat.fehler).toBe(3)
  await ui.unmount()
})

deTest('Verlauf: höchstens 10 Wechsel gespeichert, im Prompt die letzten 6', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  for (let i = 1; i <= 11; i++) {
    await ui.input({ key: 'ask', text: `Frage Nummer ${i}` })
    await flush()
  }
  expect(w.chat()!.turns.length).toBe(10)
  expect(w.chat()!.turns[0]!.q).toBe('Frage Nummer 2')
  const last = w.chats.at(-1)!.prompt
  expect(last).toContain('Q: Frage Nummer 5')
  expect(last).not.toContain('Q: Frage Nummer 4\n')
  expect((last.match(/Q: Frage Nummer/g) ?? []).length).toBe(6)
  await ui.unmount()
})

deTest('„Im Chat mit … senden“: startet den mitgelieferten Skill mit dem Entwurf (Timer, $.command.run), nichts vor dem Klick', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Wie wirkt die App mehr nach Apple?' })
  await flush()
  await ui.redraw()
  expect(w.runs.length).toBe(0)
  expect(w.submits.length).toBe(0)
  await ui.press({ key: 'sidekick-chat-0-1' })
  // erst im Timer, nicht im Druck selbst
  expect(w.runs.length).toBe(0)
  await w.clock.advance(100)
  await flush()
  expect(w.runs).toEqual([{ command: 'sidekick:apple-design', args: 'Bau mir ein Shorts-Template mit Remotion.' }])
  expect(w.submits.length).toBe(0)
  expect(w.toasts).toContain(X.sentSkill('apple-design'))
  expect(today(w.ledger()).chat.skill).toBe(1)
  await ui.unmount()
})

deTest('„Im Chat mit … senden“: ohne Entwurf die Frage; Start scheitert → Zeile kopiert mit Hinweis, nicht gezählt', async ($, on) => {
  const w = world(on, { runFails: true })
  w.setReply(JSON.stringify({ antwort: 'Nimm apple-design.', vorschlaege: [{ id: 'emil-apple', warum: 'Apple-Look' }] }))
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Wie wirkt die App mehr nach Apple?' })
  await flush()
  await ui.redraw()
  await ui.press({ key: 'sidekick-chat-0-0' })
  await w.clock.advance(100)
  await flush()
  expect(w.runs).toEqual([{ command: 'sidekick:apple-design', args: 'Wie wirkt die App mehr nach Apple?' }])
  expect(w.copies).toEqual(['/sidekick:apple-design Wie wirkt die App mehr nach Apple?'])
  expect(w.toasts.at(-1)).toContain('Die Zeile ist kopiert')
  expect(today(w.ledger()).chat.skill).toBe(0)
  await ui.unmount()
})

deTest('Desktop: URL kopieren mit Connector-Hinweis; Befehl kopieren (Shell-Zeile → Terminal); Entwurf erst nach „Jetzt senden?“', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.redraw()
  await ui.press({ key: 'sidekick-chat-0-2' })
  await flush()
  expect(w.copies).toEqual(['https://mcp.higgsfield.ai/mcp'])
  expect(w.toasts.at(-1)).toContain('Einstellungen → Connectors → Eigenen Connector hinzufügen')
  await ui.press({ key: 'sidekick-chat-0-0' })
  await flush()
  expect(w.copies.at(-1)).toBe('claude mcp add --transport http suno https://api.suno.com/mcp')
  expect(w.toasts.at(-1)).toContain('In einem Terminal ausführen')
  // Entwurf: Dialog geschlossen → nichts gesendet
  await ui.press({ key: 'sidekick-chat-0-draft' })
  await w.clock.advance(100)
  await flush()
  expect(w.asks.length).toBe(1)
  expect(w.submits.length).toBe(0)
  w.setAnswer(X.optSend)
  await ui.press({ key: 'sidekick-chat-0-draft' })
  await w.clock.advance(100)
  await flush()
  expect(w.submits.map((s) => s.text)).toEqual(['Bau mir ein Shorts-Template mit Remotion.'])
  expect(w.submits[0]!.context ?? []).toEqual([])
  const d = today(w.ledger()).chat
  expect(d).toMatchObject({ url: 1, kopiert: 1, entwurf: 1 })
  await ui.unmount()
})

deTest('Terminal: Entwurf und installierter Befehl ins leere Eingabefeld; Zeile kopiert', async ($, on) => {
  const w = world(on, { surfaces: ['terminal'], cmds: [{ name: 'mod-debug', source: 'projectSettings' }] })
  w.setReply(JSON.stringify({ antwort: 'Debuggen.', vorschlaege: [{ id: 'mod-debug', warum: 'Projekt-Befehl' }, { id: 'higgsfield', warum: 'x' }], anChat: 'Finde den Fehler.' }))
  await start($, 'terminal')
  const ui = await pane($, 'terminal')
  await ui.input({ key: 'ask', text: 'Wie gehe ich einen hartnäckigen Bug an?' })
  await flush()
  await ui.redraw()
  const drawn = JSON.stringify(await ui.drawn())
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-0' }))).toContain(`"label":"${X.btnCmd}"`)
  // Der Befehl steht als Name in der Zeile, darunter Art und Stand
  expect(drawn).toContain('"children":["/mod-debug"]')
  expect(drawn).toContain(`${X.kinds.command} · ${X.stInstalled}`)
  // Terminal: der Fenstertitel fehlt bei einem Fenster, darum „sidekick“ im Kopf; „⏎ fragen“ zeichnet das Terminal selbst
  expect(drawn).toContain('"children":["sidekick "]')
  expect(drawn).not.toContain(X.enterSends)
  expect(drawn).not.toContain('"backgroundColor"')
  await ui.press({ key: 'sidekick-chat-0-0' })
  await flush()
  expect(w.fills).toEqual(['/mod-debug '])
  // Terminal: Zeile statt URL
  await ui.press({ key: 'sidekick-chat-0-1' })
  await flush()
  expect(w.copies).toEqual(['claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp'])
  await ui.press({ key: 'sidekick-chat-0-draft' })
  await flush()
  expect(w.fills.at(-1)).toBe('Finde den Fehler.')
  expect(w.submits.length).toBe(0)
  expect(today(w.ledger()).chat).toMatchObject({ befehl: 1, kopiert: 1, entwurf: 1 })
  await ui.unmount()
})

deTest('-p (keine Oberfläche): /sidekick chat <frage> antwortet als Befehlsausgabe, ohne Fenster und Verlauf; ohne Frage ein Hinweis', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await start($)
  const r = await run($, 'chat Ich will Shorts zu meinem Browserspiel machen. Was brauche ich?')
  expect(w.opens.length).toBe(0)
  expect(r.text).toContain('Für Shorts: **Remotion** ist da')
  expect(r.text).toContain('**Vorschläge**')
  expect(r.text).toContain('`claude mcp add --transport http suno https://api.suno.com/mcp`')
  expect(r.text).toContain('**Entwurf für den Chat**')
  expect(w.chat()).toBeUndefined()
  expect((await run($, 'chat')).text).toBe(X.noPane)
})

deTest('Fenster geht nicht auf: mit Frage Antwort als Ausgabe, ohne Frage ein Hinweis mit Grund', async ($, on) => {
  const w = world(on, { placed: false })
  await start($)
  expect((await run($, 'chat')).text).toBe(X.notPlaced('narrow'))
  const r = await run($, 'chat Trailer-Musik?')
  expect(r.text).toContain('Für Shorts')
  expect(w.chats.length).toBe(1)
})

deTest('Stufe Aus: nur ein Hinweis, kein Fenster, kein Modell', { level: 'off' }, async ($, on) => {
  const w = world(on)
  await start($)
  expect((await run($, 'chat Trailer?')).text).toBe(X.off)
  expect(w.opens.length).toBe(0)
  expect(w.chats.length).toBe(0)
})

deTest('Stufe Cache: der Chat geht (der Nutzer ruft ihn ausdrücklich)', { level: 'cache' }, async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'chat')
  expect(w.opens.length).toBe(1)
})

deTest('/clear: neue Sitzung, das Fenster zeigt einen leeren Verlauf', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Erste Frage' })
  await flush()
  expect(w.chat()!.turns.length).toBe(1)
  w.setSid('sess-2')
  await start($)
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.empty)
  expect(all).not.toContain('Erste Frage')
  await ui.input({ key: 'ask', text: 'Zweite Frage' })
  await flush()
  expect(w.chat()!.sid).toBe('sess-2')
  expect(w.chat()!.turns.map((t) => t.q)).toEqual(['Zweite Frage'])
  // Im Prompt kein Verlauf der alten Sitzung
  expect(w.chats.at(-1)!.prompt).not.toContain('Erste Frage')
  await ui.unmount()
})

test('Englisch: Fenster und Knöpfe englisch', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Trailer music?' })
  await flush()
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(all).toContain(T.en.chat.head)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-1' }))).toContain(`"label":"${T.en.chat.btnSkill}"`)
  expect(all).toContain('Skill · MIT · ships with sidekick, ≈ 5.8k tokens of context')
  expect(all).toContain('1 question · ')
  expect(all).toContain(T.en.chat.draft)
  expect(all).not.toContain(T.de.chat.draft)
  expect(w.chats.length).toBe(1)
  await ui.unmount()
  setLang('de')
})

// ---------- Review 0.30.0 ----------

deTest('Review S1: der Entwurf steht vor dem Klick sichtbar unter der Antwort', async ($, on) => {
  world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  // Nachtrag 0.31.1: Überschrift, dann der Entwurf in voller Stärke (nicht gedimmt) in sidekicks blauer Box, darunter sein Knopf
  const at = all.indexOf(`"children":["${X.draft}"]`)
  expect(at > 0).toBe(true)
  const box = all.slice(at, all.indexOf('sidekick-chat-0-draft'))
  expect(box).toContain('"borderColor":"#6CB6FF"')
  expect(box).toContain('"backgroundColor":"#6CB6FF14"')
  expect(box).toContain('{"type":"Text","props":{"wrap":"wrap"},"children":["Bau mir ein Shorts-Template mit Remotion."]}')
  await ui.unmount()
})

deTest('Review S2: eine sehr lange Frage wird im Verlauf und im Prompt gekürzt; das Fenster zeichnet weiter', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'x'.repeat(150000) })
  await flush()
  expect(w.chat()!.turns[0]!.q.length <= 2000).toBe(true)
  expect(w.chats[0]!.prompt.length < 60000).toBe(true)
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn())).toContain(X.head)
  await ui.unmount()
})

deTest('Review S3: /clear während einer Antwort → der alte Wechsel landet nicht im neuen Chat', async ($, on) => {
  const w = world(on)
  await start($)
  const release = w.holdOn()
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Alte Frage' })
  await flush()
  expect(w.chat()!.busy).toEqual({ q: 'Alte Frage' })
  w.setSid('sess-2')
  await start($)
  release()
  await flush()
  const s = w.chat()!
  expect(s.turns.map((t) => t.q)).not.toContain('Alte Frage')
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn())).not.toContain('Alte Frage')
  // Danach geht eine neue Frage wieder (keine Sperre durch die alte)
  await ui.input({ key: 'ask', text: 'Neue Frage' })
  await flush()
  expect(w.chat()!.sid).toBe('sess-2')
  expect(w.chat()!.turns.map((t) => t.q)).toEqual(['Neue Frage'])
  await ui.unmount()
})

deTest('Review K3: Fenster offen auf Stufe Aus (z. B. nach /sidekick off) → keine Frage an Sonnet, Toast', { level: 'off' }, async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Trailer?' })
  await flush()
  expect(w.chats.length).toBe(0)
  expect(w.toasts).toContain(X.off)
  await ui.unmount()
})

deTest('Review K2: im Desktop-Widget nur Kopf und letzte Antwort, ohne Eingabefeld und Knöpfe', async ($, on) => {
  world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.unmount()
  const wdg = await $.ui.mount({ plugin: 'sidekick', component: 'Pane', requestId: 'sidekick-chat', surface: 'desktop', props: { title: 'sidekick', isFocused: false, bodyColumns: 30, placement: 'widget', anchoredEdges: ['bottom', 'right'] } } as never)
  const all = JSON.stringify(await wdg.drawn())
  expect(all).toContain(X.head)
  expect(all).toContain('Für Shorts:')
  expect(await wdg.find({ key: 'ask' })).toBeUndefined()
  expect(await wdg.find({ key: 'sidekick-chat-0-0' })).toBeUndefined()
  await wdg.unmount()
})

deTest('Review K7: VS Code zeichnet das Fenster mit Eingabefeld und Knöpfen (Zeile statt URL)', async ($, on) => {
  const w = world(on, { surfaces: ['vscode'] })
  await start($, 'vscode')
  await run($, 'chat')
  expect(w.opens.length).toBe(1)
  const ui = await pane($, 'vscode')
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.redraw()
  expect(await ui.find({ key: 'ask' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-2' }))).toContain(`"label":"${X.btnCopy}"`)
  expect(JSON.stringify(await ui.drawn())).toContain('"children":["Higgsfield MCP"]')
  await ui.unmount()
})

deTest('Review K7: $.tool.list scheitert → keine Server, die Frage geht trotzdem', async ($, on) => {
  const w = world(on, { toolsFail: true })
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  expect(w.chats.length).toBe(1)
  expect(w.chats[0]!.prompt).toContain('[MCP SERVERS]\n(none)\n[/MCP SERVERS]')
  expect(w.chat()!.turns[0]!.err).toBeUndefined()
  // auch /sidekick catalog läuft ohne Server
  expect((await run($, 'catalog')).text).toContain('higgsfield')
  await ui.unmount()
})

deTest('Review K7: Kopieren scheitert → Hinweis mit dem Text, nicht gezählt; Befehl ohne Feld (Desktop) ebenso', async ($, on) => {
  const w = world(on, { copyFails: true, cmds: [{ name: 'mod-debug', source: 'projectSettings' }] })
  w.setReply(JSON.stringify({ antwort: 'So.', vorschlaege: [{ id: 'suno', warum: 'x' }, { id: 'higgsfield', warum: 'y' }, { id: 'mod-debug', warum: 'z' }] }))
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Musik?' })
  await flush()
  await ui.redraw()
  await ui.press({ key: 'sidekick-chat-0-0' })
  await flush()
  expect(w.toasts.at(-1)).toBe(X.copyFailed('claude mcp add --transport http suno https://api.suno.com/mcp'))
  await ui.press({ key: 'sidekick-chat-0-1' })
  await flush()
  expect(w.toasts.at(-1)).toContain('Kopieren ging nicht. URL: https://mcp.higgsfield.ai/mcp')
  await ui.press({ key: 'sidekick-chat-0-2' })
  await flush()
  expect(w.toasts.at(-1)).toBe(X.copyFailed('/mod-debug'))
  expect(today(w.ledger()).chat).toMatchObject({ kopiert: 0, url: 0, befehl: 0 })
  await ui.unmount()
})

// ---------- Nachtrag 0.31.1: Gestaltung des Fensters ----------

const paneAt = ($: Engine, surface: string, cols: number) =>
  $.ui.mount({ plugin: 'sidekick', component: 'Pane', requestId: 'sidekick-chat', surface, props: { title: 'sidekick', isFocused: true, bodyColumns: cols, placement: 'dock' } } as never)
const NO_DRAFT = JSON.stringify({ antwort: 'Nimm Suno.', vorschlaege: [{ id: 'gsap', warum: 'schon da' }, { id: 'suno', warum: 'Musik' }, { id: 'higgsfield', warum: 'Clips' }] })

deTest('0.31.1 leer: Klick auf eine Beispielfrage stellt sie (wie getippt); danach kein leerer Zustand mehr', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.press({ key: 'sidekick-chat-ex-1' })
  await flush()
  expect(w.chats.length).toBe(1)
  expect(w.chats[0]!.prompt).toContain(X.examples[1]!.q)
  expect(w.chat()!.turns.map((t) => t.q)).toEqual([X.examples[1]!.q])
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(all).not.toContain(X.emptyHead)
  expect(await ui.find({ key: 'sidekick-chat-ex-0' })).toBeUndefined()
  await ui.unmount()
})

deTest('0.31.1 leer: Lücke zwischen den Beispiel-Knöpfen im Desktop (klein) und in VS Code (eine Zeile), im Terminal keine', async ($, on) => {
  world(on, { surfaces: ['desktop', 'vscode', 'terminal'] })
  await start($)
  for (const [surface, gap] of [['desktop', '"sm"'], ['vscode', '1'], ['terminal', '0']] as const) {
    const ui = await paneAt($, surface, 70)
    expect(JSON.stringify(await ui.drawn())).toContain(`{"flexDirection":"column","alignItems":"flex-start","rowGap":${gap}}`)
    await ui.unmount()
  }
})

deTest('0.31.1 Hauptknopf: ohne Entwurf der erste Vorschlag mit Knopf, nur in der neuesten Antwort; Eintrag ohne Knopf bleibt als Zeile', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'gsap-skills:gsap-core', plugin: 'gsap-skills' }] })
  w.setReply(NO_DRAFT)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Musik?' })
  await flush()
  await ui.redraw()
  let all = JSON.stringify(await ui.drawn())
  // gsap ist installiert: Zeile mit Stand, aber kein Knopf
  expect(await ui.find({ key: 'sidekick-chat-0-0' })).toBeUndefined()
  expect(all).toContain('schon da')
  expect(all).toContain(`· ${X.stInstalled}`)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-1' }))).toContain('"variant":"primary"')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-2' }))).not.toContain('"variant"')
  expect(all.split('"variant":"primary"').length - 1).toBe(1)
  // zweite Antwort: der Hauptknopf wandert mit
  await ui.input({ key: 'ask', text: 'Und Clips?' })
  await flush()
  await ui.redraw()
  all = JSON.stringify(await ui.drawn())
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-0-1' }))).not.toContain('"variant"')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-1-1' }))).toContain('"variant":"primary"')
  expect(all.split('"variant":"primary"').length - 1).toBe(1)
  // der alte Knopf wirkt weiter
  await ui.press({ key: 'sidekick-chat-0-1' })
  await flush()
  expect(w.copies).toEqual(['claude mcp add --transport http suno https://api.suno.com/mcp'])
  await ui.unmount()
})

deTest('0.31.1 Fehler: Ursache, nächster Schritt und „Nochmal fragen“ nur beim neuesten Wechsel; der Knopf stellt die Frage erneut', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  w.setReply({ reason: 'api-error', status: 529 })
  await ui.input({ key: 'ask', text: 'eins' })
  await flush()
  await ui.redraw()
  let all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.failed('HTTP 529'))
  expect(all).toContain(X.errNext)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-retry' }))).toContain(X.btnRetry)
  // kein Hauptknopf bei einem Fehler, nichts nur über Farbe: der Text nennt den Fehler
  expect(all).not.toContain('"variant":"primary"')
  w.setReply(ANSWER)
  await ui.press({ key: 'sidekick-chat-retry' })
  await flush()
  expect(w.chats.length).toBe(2)
  expect(w.chats[1]!.prompt).toContain('[QUESTION]\neins\n[/QUESTION]')
  expect(w.chat()!.turns.map((t) => t.err ?? 'ok')).toEqual(['failed', 'ok'])
  await ui.redraw()
  all = JSON.stringify(await ui.drawn())
  // der alte Fehler bleibt als Zeile stehen, aber ohne Knopf und ohne den Satz zum nächsten Schritt
  expect(all).toContain(X.failed('HTTP 529'))
  expect(all).not.toContain(X.errNext)
  expect(await ui.find({ key: 'sidekick-chat-retry' })).toBeUndefined()
  await ui.unmount()
})

deTest('0.31.1 Warten: während eine Antwort läuft, hat die ältere Antwort keinen Hauptknopf und ein alter Fehler kein „Nochmal fragen“', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  w.setReply({ reason: 'api-error', status: 500 })
  await ui.input({ key: 'ask', text: 'eins' })
  await flush()
  w.setReply(ANSWER)
  const release = w.holdOn()
  await ui.input({ key: 'ask', text: 'zwei' })
  await flush()
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(all).toContain(X.thinking)
  expect(await ui.find({ key: 'sidekick-chat-retry' })).toBeUndefined()
  expect(all).not.toContain('"variant":"primary"')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-chat-cancel' }))).toContain('"dimColor":true')
  release()
  await flush()
  await ui.unmount()
})

deTest('0.31.1 schmal: unter 44 Spalten steht der Knopf unter dem Text, die Frage rückt nicht ein; breit steht er neben dem Namen', async ($, on) => {
  world(on)
  await start($)
  const wide = await pane($)
  await wide.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await wide.redraw()
  const w70 = JSON.stringify(await wide.drawn())
  expect(w70).toContain('"alignItems":"center","justifyContent":"space-between"')
  expect(w70).toContain('"marginLeft":6')
  await wide.unmount()
  for (const surface of ['desktop', 'terminal', 'vscode']) {
    const ui = await paneAt($, surface, CHAT_NARROW - 1)
    const all = JSON.stringify(await ui.drawn())
    expect(all).not.toContain('"alignItems":"center","justifyContent":"space-between"')
    expect(all).toContain('"marginLeft":0')
    expect(all).toContain(`"width":${CHAT_NARROW - 1}`)
    for (const key of ['ask', 'sidekick-chat-0-0', 'sidekick-chat-0-1', 'sidekick-chat-0-2', 'sidekick-chat-0-draft']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  }
  // Untergrenze der Breite wie bisher
  const tiny = await paneAt($, 'desktop', 8)
  expect(JSON.stringify(await tiny.drawn())).toContain('"width":20')
  await tiny.unmount()
})

deTest('0.31.1 K8: das Eingabefeld bekommt in jedem Zustand denselben `value` (so behält es halb getippten Text); Tippen stellt keine Frage', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  const field = async () => JSON.stringify(((await ui.find({ key: 'ask' })) as { props?: unknown }).props)
  const empty = await field()
  expect(empty).toContain('"value":""')
  // halb getippt (kind change): kein Aufruf, kein Verlauf
  await ui.input({ key: 'ask', text: 'Ich will', kind: 'change' } as never)
  await flush()
  expect(w.chats.length).toBe(0)
  expect(w.chat()).toBeUndefined()
  // wartend
  const release = w.holdOn()
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn())).toContain(X.thinking)
  expect(await field()).toBe(empty)
  // Antwort da
  release()
  await flush()
  await ui.redraw()
  expect(JSON.stringify(await ui.drawn())).toContain(X.btnDraft)
  expect(await field()).toBe(empty)
  // Fehler
  w.setReply({ reason: 'api-error', status: 500 })
  await ui.input({ key: 'ask', text: 'Noch eine' })
  await flush()
  await ui.redraw()
  expect(await ui.find({ key: 'sidekick-chat-retry' })).toBeDefined()
  expect(await field()).toBe(empty)
  await ui.unmount()
})

// ---------- Review 0.31.1 ----------

deTest('Review 0.31.1 S1: Verlauf aus $.state ohne gelesene Befehle (nach einem Neuladen) → Zeilen ohne Stand; nach der nächsten Frage mit Stand', async ($, on) => {
  const w = world(on)
  await start($)
  const old: ChatTurn = { q: 'Alt?', a: 'Nimm das.', sugg: [{ id: 'sp-debug', warum: 'Ursache zuerst' }, { id: 'higgsfield', warum: 'Clips' }], usd: 0.02 }
  w.state.set('sidekick.chat', { sid: 'sess-1', turns: [old], n: 1, usd: 0.02 })
  const ui = await pane($)
  let all = JSON.stringify(await ui.drawn())
  expect(all).toContain('"children":["Skill · MIT"]')
  expect(all).not.toContain(X.stMissing)
  expect(all).not.toContain(X.stNotConnected)
  expect(all).toContain('Ursache zuerst')
  // Kosten je Frage aus dem Verlauf
  expect(all).toContain(`${X.enterSends} · ${X.perQuestion('≈ 0,02 $')}`)
  await ui.input({ key: 'ask', text: 'Neu?' })
  await flush()
  await ui.redraw()
  all = JSON.stringify(await ui.drawn())
  expect(all).toContain(`Skill · MIT · ${X.stMissing}`)
  await ui.unmount()
})

deTest('Review 0.31.1 S2: nach einer gescheiterten ersten Frage steht unter dem Feld der übliche Wert, nicht „≈ 0 $“', async ($, on) => {
  const w = world(on)
  w.setReply(new Error('kein Netz'))
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'eins' })
  await flush()
  await ui.redraw()
  const all = JSON.stringify(await ui.drawn())
  expect(w.chat()!.turns[0]).toMatchObject({ err: 'failed', usd: 0 })
  expect(all).toContain(X.perQuestion('≈ 0,03 $'))
  expect(all).not.toContain(X.perQuestion('≈ 0 $'))
  await ui.unmount()
})

deTest('Review 0.31.1 K6, K1, VS Code: schmaler Kopf untereinander; Quelle statt Knopf; VS Code ohne Füllung der Entwurf-Box; Grenze genau 44', async ($, on) => {
  const w = world(on, { surfaces: ['desktop', 'vscode'] })
  w.setReply(JSON.stringify({ antwort: 'So.', vorschlaege: [{ id: 'video-use', warum: 'Schnitt' }], anChat: 'Schneide das Video.' }))
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Schnitt?' })
  await flush()
  await ui.redraw()
  const wide = JSON.stringify(await ui.drawn())
  expect(wide).toContain('{"flexDirection":"row","justifyContent":"space-between","columnGap":2}')
  expect(wide).toContain(byId('video-use')!.url)
  expect(await ui.find({ key: 'sidekick-chat-0-0' })).toBeUndefined()
  expect(wide).toContain('"backgroundColor":"#6CB6FF14"')
  await ui.unmount()
  // genau an der Grenze gilt noch die breite Form
  const edge = await paneAt($, 'desktop', CHAT_NARROW)
  expect(JSON.stringify(await edge.drawn())).toContain('"marginLeft":6')
  await edge.unmount()
  const slim = await paneAt($, 'desktop', CHAT_NARROW - 1)
  const narrow = JSON.stringify(await slim.drawn())
  expect(narrow).not.toContain('"justifyContent":"space-between"')
  expect(narrow).toContain(X.cost('≈ 0,03 $', 1))
  await slim.unmount()
  const vs = await paneAt($, 'vscode', 70)
  const code = JSON.stringify(await vs.drawn())
  expect(code).toContain('"borderColor":"#6CB6FF"')
  expect(code).not.toContain('"backgroundColor"')
  await vs.unmount()
})

test('Review 0.31.1 K8: Englisch im leeren Fenster und nach einem Fehler', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  const E = T.en.chat
  const w = world(on)
  w.setReply({ reason: 'api-error', status: 500 })
  await start($)
  const ui = await pane($)
  let all = JSON.stringify(await ui.drawn())
  for (const s of [E.emptyHead, E.empty, E.exHead, E.examples[0]!.label, E.placeholder, E.enterSends]) expect(all).toContain(s)
  await ui.press({ key: 'sidekick-chat-ex-2' })
  await flush()
  expect(w.chats[0]!.prompt).toContain(E.examples[2]!.q)
  await ui.redraw()
  all = JSON.stringify(await ui.drawn())
  for (const s of [E.failed('HTTP 500'), E.errNext, E.btnRetry]) expect(all).toContain(s)
  expect(all).not.toContain(T.de.chat.errNext)
  await ui.unmount()
  setLang('de')
})

// ---------- Katalog im Haupt-Chat (Ausbau 0.30.0) ----------

const MUSIC = 'Ich brauche Trailer-Musik für mein Browserspiel, am besten episch'
const send = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never) as Promise<{ text?: string; drop?: string; context?: readonly string[] }>

const catWorld = (on: On, reply: string, surfaces: string[], servers: string[] = []) => world(on, { surfaces, servers, catReply: reply })

deTest('Haupt-Chat: paid (Suno) ab 0,85 → keine Rückfrage, nur Zeile mit Kosten; Knopf kopiert die Zeile', async ($, on) => {
  const w = catWorld(on, '{"id":"suno","sicher":0.95,"grund":"Trailer-Musik erzeugen"}', ['terminal'])
  await start($, 'terminal')
  const r = await send($, MUSIC)
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe(MUSIC)
  expect(w.asks.length).toBe(0)
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'u1', surface: 'terminal', props: { text: MUSIC, origin: { kind: 'composer' }, isExpanded: true } } as never)
  const line = JSON.stringify(await ui.find({ key: 'sidekick-line' }))
  expect(line).toContain('Suno MCP (beta) von Suno (Dienst, Beta, Credits des Suno-Plans')
  expect(line).toContain('Trailer-Musik erzeugen')
  await ui.press({ key: 'sidekick-use' })
  await flush()
  expect(w.copies).toEqual(['claude mcp add --transport http suno https://api.suno.com/mcp'])
  await ui.unmount()
})

deTest('Haupt-Chat: paid unter 0,85 → nichts', async ($, on) => {
  const w = catWorld(on, '{"id":"suno","sicher":0.8,"grund":"Musik"}', ['desktop'])
  await start($)
  const r = await send($, MUSIC)
  expect(r.text).toBe(MUSIC)
  expect(w.asks.length).toBe(0)
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'u1', surface: 'desktop', props: { text: MUSIC, origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(await ui.find({ key: 'sidekick-line' })).toBeUndefined()
  await ui.unmount()
})

deTest('Haupt-Chat: Connector im Desktop → Knopf „URL kopieren“ mit Hinweis Connectors', async ($, on) => {
  const text = 'Ich möchte aus Screenshots meines Spiels ein KI-Video generieren lassen'
  const w = catWorld(on, '{"id":"higgsfield","sicher":0.95,"grund":"Clips aus Bildern"}', ['desktop'])
  await start($)
  await send($, text)
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'u1', surface: 'desktop', props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-use' }))).toContain(T.de.cat.btnUrl)
  await ui.press({ key: 'sidekick-use' })
  await flush()
  expect(w.copies).toEqual(['https://mcp.higgsfield.ai/mcp'])
  expect(w.toasts.at(-1)).toContain('Einstellungen → Connectors → Eigenen Connector hinzufügen')
  await ui.unmount()
})

deTest('Haupt-Chat: verbundener fal-Connector (Terminal-Name) → kein Kandidat, kein Haiku', async ($, on) => {
  const text = 'Kannst du mir ein Bild generieren für den Store-Eintrag meines Spiels?'
  const w = world(on, { surfaces: ['terminal'], servers: ['claude_ai_fal_Bilder_Videos'], catReply: '{"id":"fal","sicher":0.99,"grund":"x"}' })
  await start($, 'terminal')
  const r = await send($, text)
  expect(r.text).toBe(text)
  expect(w.catCalls()).toBe(0)
})

deTest('/sidekick catalog: Art, Dienst, kostenpflichtig, zusammengesetzt, URL; Stand „?“ im Desktop; Knopf „URL kopieren“', async ($, on) => {
  const w = world(on, { servers: [FAL_DESKTOP] })
  await start($)
  const md = (await run($, 'catalog')).text ?? ''
  expect(md).toContain('| `higgsfield` Higgsfield MCP | Higgsfield | Dienst | Connector, Verweis, nur Hinweis, kostenpflichtig, zusammengesetzt, Credits, Uploads an Higgsfield | ? |')
  expect(md).toContain('| `yutu` yutu YouTube skill | eat-pray-ai | Apache-2.0 | Skill, Verweis, npx, ungepinnt | aktiv |')
  expect(md).toContain('- `luma`: `claude mcp add --transport http --scope user luma https://agents.lumalabs.ai/mcp` · URL kopieren: https://agents.lumalabs.ai/mcp')
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'desktop', props: { command: 'sidekick', args: 'catalog', text: md, isErrored: false } } as never)
  await ui.press({ key: 'sidekick-cat-url-vidiq' })
  await flush()
  expect(w.copies).toEqual(['https://mcp.vidiq.com/mcp'])
  await ui.unmount()
})

deTest('/sidekick catalog im Terminal: verbundener Connector „installiert“', async ($, on) => {
  world(on, { surfaces: ['terminal'], servers: ['claude_ai_fal_Bilder_Videos'] })
  await start($, 'terminal')
  const md = (await run($, 'catalog')).text ?? ''
  expect(md).toContain('| `fal` fal MCP | fal | Dienst | MCP, Verweis, nur Hinweis, kostenpflichtig, Credits je Lauf, Uploads an fal | installiert |')
})

// ---------- Nachtrag 0.32.0: Knopf „Chat“ (auf/zu), Eingabefeld wächst mit, Kosten je Frage, Abstand unter dem Entwurf ----------

const footer = ($: Engine) => $.ui.mount({ plugin: 'sidekick', component: 'SessionMode', requestId: 'mode', surface: 'desktop', props: { modes: [] } } as never)

deTest('0.32.0 Knopf „Chat“: öffnet wie /sidekick chat, ein zweiter Druck schließt das sichtbare Fenster; der Befehl schließt nie', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await footer($)
  await ui.press({ key: 'sidekick-chat-open' })
  await flush()
  // Derselbe Aufruf wie /sidekick chat (chatCommand), keine Ausgabe, kein Toast
  expect(w.opens).toEqual([{ id: 'sidekick-chat', title: 'sidekick', focus: true, closeOnEscape: true }])
  expect(w.closes).toEqual([])
  expect(w.toasts).toEqual([])
  await ui.press({ key: 'sidekick-chat-open' })
  await flush()
  expect(w.opens.length).toBe(1)
  expect(w.closes).toMatchObject([{ id: 'sidekick-chat' }])
  // Dritter Druck: wieder auf
  await ui.press({ key: 'sidekick-chat-open' })
  await flush()
  expect(w.opens.length).toBe(2)
  await ui.unmount()
  // /sidekick chat bei offenem Fenster: öffnet erneut (eine Id, ein Fenster, types@2.1.326:8709-8710), schließt nicht
  await run($, 'chat')
  expect(w.opens.length).toBe(3)
  expect(w.closes.length).toBe(1)
})

deTest('0.32.0 Knopf „Chat“: Fenster geht nicht auf → Toast mit dem Satz des Befehls (Aus ohne Knopf: sidekick.test.ts)', async ($, on) => {
  const w = world(on, { placed: false })
  await start($)
  const ui = await footer($)
  await ui.press({ key: 'sidekick-chat-open' })
  await flush()
  expect(w.toasts).toContain(X.notPlaced('narrow'))
  expect(w.closes).toEqual([])
  await ui.unmount()
})

test('0.32.0 inputRows: 1 Zeile leer und kurz, wächst mit Länge und Zeilenumbrüchen, höchstens CHAT_ROWS_MAX', () => {
  const width = 70 - CHAT_INPUT_PAD
  expect(CHAT_ROWS_MAX).toBe(6)
  expect(inputRows('', 70)).toBe(1)
  expect(inputRows('kurz', 70)).toBe(1)
  expect(inputRows('x'.repeat(width), 70)).toBe(1)
  expect(inputRows('x'.repeat(width + 1), 70)).toBe(2)
  expect(inputRows('a\nb\nc', 70)).toBe(3)
  expect(inputRows('x'.repeat(width * 3), 70)).toBe(3)
  expect(inputRows('x'.repeat(width * 20), 70)).toBe(CHAT_ROWS_MAX)
  expect(inputRows('a\n'.repeat(30), 70)).toBe(CHAT_ROWS_MAX)
  // Sehr schmal: mindestens 10 Zellen Text je Zeile
  expect(inputRows('x'.repeat(10), 5)).toBe(1)
  expect(inputRows('x'.repeat(11), 5)).toBe(2)
})

deTest('0.32.0 Eingabefeld: einzeilig, wächst beim Tippen (kind change) ohne Frage und ohne value-Wechsel; nach Enter wieder 1', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  const props = async () => ((await ui.find({ key: 'ask' })) as { props: Record<string, unknown> }).props
  expect(await props()).toMatchObject({ rows: 1, value: '' })
  // 70 Spalten: 58 Zellen je Zeile; 150 Zeichen → 3 Zeilen
  await ui.input({ key: 'ask', text: 'x'.repeat(150), kind: 'change' } as never)
  await flush()
  await ui.redraw()
  expect(await props()).toMatchObject({ rows: 3, value: '' })
  expect(w.chats.length).toBe(0)
  await ui.input({ key: 'ask', text: 'x'.repeat(5000), kind: 'change' } as never)
  await flush()
  await ui.redraw()
  expect((await props()).rows).toBe(CHAT_ROWS_MAX)
  // Enter: Frage geht, das Feld ist wieder einzeilig
  await ui.input({ key: 'ask', text: 'Wie baue ich ein Thumbnail?' })
  await flush()
  await ui.redraw()
  expect(w.chats.length).toBe(1)
  expect((await props()).rows).toBe(1)
  await ui.unmount()
})

deTest('0.32.0 Kosten je Frage: über jeder beantworteten Frage klein „kostete …“, über einer ohne Kosten nichts', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.redraw()
  const usd = w.chat()!.turns[0]!.usd
  expect(usd > 0).toBe(true)
  const all = JSON.stringify(await ui.drawn())
  const cost = all.indexOf(X.turnCost(usdText(usd)))
  expect(cost > 0).toBe(true)
  // Die Kosten stehen vor (über) der Frage
  expect(cost < all.indexOf('"children":["Shorts?"]')).toBe(true)
  expect(all).toContain('"size":"caption","dimColor":true,"tabular":true')
  await ui.unmount()
  // Fehler ohne Kosten: kein „kostete“
  w.setReply(new Error('down'))
  const ui2 = await pane($)
  await ui2.input({ key: 'ask', text: 'Zweite?' })
  await flush()
  await ui2.redraw()
  const s = JSON.stringify(await ui2.drawn())
  expect(s.split(X.turnCost('').trim()).length - 1).toBe(1)
  await ui2.unmount()
})

deTest('0.32.0 (Nachtrag 0.31.3): Entwurf, blaue Box und Knopf in einer Spalte mit Abstand sm', async ($, on) => {
  world(on)
  await start($)
  const ui = await pane($)
  await ui.input({ key: 'ask', text: 'Shorts?' })
  await flush()
  await ui.redraw()
  const col = (await ui.find({ key: 'sidekick-chat-draftbox-0' })) as { props: Record<string, unknown>; children: unknown[] }
  expect(col.props).toMatchObject({ flexDirection: 'column', rowGap: 'sm' })
  expect(col.children.length).toBe(3)
  expect(JSON.stringify(col.children[2])).toContain('sidekick-chat-0-draft')
  await ui.unmount()
})

test('0.32.0 Texte: turnCost und chatOpen in en und de', () => {
  expect(T.de.chat.turnCost('≈ 0,02 $')).toBe('kostete ≈ 0,02 $')
  expect(T.en.chat.turnCost('≈ $0.02')).toBe('cost ≈ $0.02')
  expect(T.de.chatOpen).toBe('Chat')
  expect(T.en.chatOpen).toBe('Chat')
})

deTest('0.32.0 Review K1/K2: Schließen abgelehnt → eigener Toast; ein neu geöffnetes Fenster beginnt wieder einzeilig', async ($, on) => {
  const w = world(on, { closeDeny: true })
  await start($)
  const ui = await footer($)
  await ui.press({ key: 'sidekick-chat-open' })
  await flush()
  const p = await pane($)
  await p.input({ key: 'ask', text: 'x'.repeat(300), kind: 'change' } as never)
  await flush()
  await p.redraw()
  expect(((await p.find({ key: 'ask' })) as { props: Record<string, unknown> }).props.rows).toBe(CHAT_ROWS_MAX)
  // Zweiter Druck: Schließen wird abgelehnt → Satz zum Schließen, nicht „nicht aufgegangen“
  await ui.press({ key: 'sidekick-chat-open' })
  await flush()
  expect(w.toasts.at(-1)).toBe(X.closeFailed('sidekick: $.ui.close: offen lassen'))
  expect(w.toasts.some((x) => x.includes('nicht aufgegangen'))).toBe(false)
  // /sidekick chat öffnet neu: wieder eine Zeile
  await run($, 'chat')
  await p.redraw()
  expect(((await p.find({ key: 'ask' })) as { props: Record<string, unknown> }).props.rows).toBe(1)
  await p.unmount()
  await ui.unmount()
})
