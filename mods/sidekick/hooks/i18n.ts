// sidekick: Sprache (userConfig `language`, en/de) und alle sichtbaren Texte, ohne `$` (release/I18N.md).
// Die Sprache wird einmal in `register(on, options)` gesetzt; eine Änderung über /config lädt das Modul neu.
// `de` war in 0.3.0 wortgleich zu 0.2.4. Seit 0.4.0 steht statt „Haiku“ der Name aus models.ts (CHECK_NAME, HANDOFF_NAME).

import { CHECK_GEN_DE, CHECK_NAME, HANDOFF_NAME } from './models.ts'

export type Lang = 'en' | 'de'

let LANG: Lang = 'en'

/** Aus `options.language`; alles außer `de` ist Englisch (Standard). */
export function setLang(v: unknown): Lang {
  LANG = v === 'de' ? 'de' : 'en'
  return LANG
}

export const lang = (): Lang => LANG

// ---------- Formatierer (ohne Intl: in der Hooks-Laufzeit nicht belegt, release/I18N.md §5) ----------

/** Dezimalzahl: en `1.5`, de `1,5`. */
export function dec(n: number, digits: number): string {
  const s = n.toFixed(digits)
  return LANG === 'de' ? s.replace('.', ',') : s
}

/** `412k`, `1.2M` / `1,2M`, `950` */
export function tokensText(n: number): string {
  const v = Math.max(0, Math.round(n || 0))
  if (v >= 1e6) return `${dec(v / 1e6, 1)}M`
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`
  if (v >= 1e3) return `${dec(v / 1e3, 1)}k`
  return String(v)
}

/** API-Wert: en `≈ $3.30`, de `≈ 3,30 $`; negativ `≈ −…`; klein `< 0,01 $` / `< $0.01`. */
export function usdText(v: number): string {
  const amount = (x: number) => (LANG === 'de' ? `${dec(x, 2)} $` : `$${dec(x, 2)}`)
  if (!Number.isFinite(v) || v === 0) return LANG === 'de' ? '≈ 0 $' : '≈ $0'
  if (v < 0) return `≈ −${amount(Math.abs(v))}`
  if (v < 0.01) return `< ${amount(0.01)}`
  return `≈ ${amount(v)}`
}

/** Preis je Aufruf, genauer als `usdText`: bis 4 Nachkommastellen ohne Nullen am Ende, mindestens 2 (de `0,0137 $`, en `$0.0137`). */
export function usdFine(v: number): string {
  if (!Number.isFinite(v) || v <= 0 || v >= 1) return usdText(v)
  if (v < 0.0001) return LANG === 'de' ? '< 0,0001 $' : '< $0.0001'
  const s = dec(v, 4).replace(/0{1,2}$/, '')
  return LANG === 'de' ? `≈ ${s} $` : `≈ $${s}`
}

const MIN = 60000

/** Dauer: `12 min`, `2 h 5 min`, de `unter 1 min` / en `under 1 min`. */
export function spanText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / MIN)
  if (m < 1) return LANG === 'de' ? 'unter 1 min' : 'under 1 min'
  if (m <= 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

const two = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Kurzes Datum: de `06.10.`, en `Oct 6`. */
export function shortDate(ms: number): string {
  const d = new Date(ms)
  return LANG === 'de' ? `${two(d.getDate())}.${two(d.getMonth() + 1)}.` : `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// ---------- Texte ----------

const de = {
  // Rückfrage (Dialog der Engine)
  send: 'Trotzdem senden',
  fassung: `${CHECK_GEN_DE} Fassung senden`,
  newChat: 'Neuer Chat mit Übergabe',
  newPlain: 'Neuer Chat ohne Übergabe',
  abort: 'Abbrechen',
  recommended: ' (empfohlen)',
  coldUnknown: (ctx: string, usd: string) => `Cache-Zustand unbekannt: sidekick sieht diesen Chat zum ersten Mal, ${ctx} Kontext. Ist er kalt, schreibt Senden alles neu (${usd}).`,
  coldSince: (span: string, ctx: string, usd: string) => `Cache seit ${span} kalt, ${ctx} Kontext. Senden schreibt alles neu (${usd}).`,
  optNew: (label: string, usd: string) => `${label}: ${usd} (${HANDOFF_NAME}-Übergabe und kleiner neuer Chat).`,
  optPlain: (label: string, usd: string) => `${label}: ${usd} (nur deine Nachricht, wenn sie den alten Verlauf nicht braucht).`,
  howNext: 'Wie weiter?',
  fassungBlock: (f: string) => `Fassung:\n„${f}“`,
  newTopicDefault: 'Neues Thema: ein frischer Chat wäre hier günstiger.',
  fassungDefault: `${CHECK_NAME} hat eine klarere Fassung.`,
  wrongChat: (zeile: string, cold: string) => `Das passt gar nicht zu diesem Chat.${zeile ? `\n\n${zeile}` : ''}${cold ? `\n\n${cold}` : ''}\n\nAbbrechen sendet nichts, dein Text bleibt zum Kopieren stehen. Bist du im falschen Chat?`,
  // Neuer Chat
  busyHandoff: 'schreibt die Übergabe',
  busyPlain: 'startet einen neuen Chat',
  busyClear: 'leert den Chat und sendet',
  tooShort: 'zu kurz',
  handoffFailed: (why: string) => `Die Übergabe ließ sich nicht schreiben (${why}). Nachricht trotzdem in diesem Chat senden?`,
  notSent: (t: string) => `Nicht gesendet. Dein Text: „${t}“`,
  clearFailedSaved: (err: string) => `/clear ging nicht (${err}). Übergabe und Nachricht sind gespeichert: /sidekick status.`,
  clearFailedNothing: (err: string, t: string) => `/clear ging nicht (${err}). Nichts gesendet. Dein Text: „${t}“`,
  newChatStarted: (withHandoff: boolean) => `Neuer Chat ${withHandoff ? 'mit' : 'ohne'} Übergabe gestartet. Der alte Chat bleibt über /resume erreichbar.`,
  sendAfterClearFailed: (err: string, rest: string) => `Chat geleert, aber die Nachricht ließ sich nicht senden (${err}). ${rest}`,
  statusShowsHandoff: '/sidekick status zeigt Übergabe und Nachricht.',
  yourText: (t: string) => `Dein Text: „${t}“`,
  newChatFailed: (err: string, t: string) => `Neuer Chat ging nicht (${err}). Nichts gesendet. Dein Text: „${t}“`,
  dropStarting: (plain: boolean, t: string) => `sidekick: ${plain ? 'Ein neuer Chat startet' : `${HANDOFF_NAME} schreibt die Übergabe, dann startet ein neuer Chat`} mit deiner Nachricht:\n\n${t}`,
  dropAborted: (t: string) => `sidekick: nicht gesendet. Dein Text zum Kopieren:\n\n${t}`,
  dropWrongChat: (t: string) => `sidekick: nicht gesendet (falscher Chat?). Dein Text zum Kopieren:\n\n${t}`,
  handoffSep: '\n\n---\n\nMeine nächste Nachricht:\n\n',
  // Zeile unter der Nachricht
  sentFassung: `gesendet wurde ${CHECK_GEN_DE} Fassung`,
  sentLabel: 'gesendet:',
  sentPlain: (s: string) => `\n\ngesendet: „${s}“`,
  // /sidekick
  on: 'an',
  off: 'aus',
  statusTitle: (on: string) => `**${on}** · Status`,
  rowThreshold: (v: string) => `| **Schwelle** | ${v} Kontext (Prüfung ab hier) |`,
  rowBig: (v: string) => `| **Groß** | ${v} (Rückfrage, wenn der Cache kalt ist) |`,
  rowSkills: (on: string) => `| **Skills an ${CHECK_NAME}** | ${on} |`,
  rowTtl: (ttl: number, src: string) => `| **Cache-Dauer** | ${ttl} min (${src}) |`,
  ttlSet: 'gesetzt',
  ttlDefault: 'Standard',
  ttlMeasured: 'gemessen',
  rowCtx: (ctx: string, cache: string) => `| **Kontext** | ${ctx} · Cache ${cache} |`,
  summary: (s: string) => `**Kurzfassung:** ${s || 'noch keine'}`,
  lastHint: (s: string) => `**Letzter Hinweis:** ${s || 'keiner'}`,
  lastHandoff: (time: string) => `**Letzte Übergabe** (${time}):`,
  handoffMsg: (m: string) => `**Nachricht dazu:** ${m}`,
  noHandoff: '**Letzte Übergabe:** keine',
  hintsLine: (on: string, off: string) => `**Wartungs-Hinweise:** ${on}${off ? ` (aus: ${off})` : ''} · Details: \`/sidekick hints status\``,
  change: (u: string) => `Ändern: ${u}`,
  unknownArg: (a: string, u: string) => `Unbekannt: „${a}“. Möglich: ${u}`,
  savingsUsage: 'Aufruf: `/savings [today|week|all]` (knapp) oder `/savings detail [today|week|all]` (alles, Standard: gesamt)',
  hintsNoMeasure: (on: string, u: string) => `Wartungs-Hinweise ${on}. Messwerte fehlen hier (kein breakdown oder kein Projekt).\n\nÄndern: ${u}`,
  cmdSidekick: 'Sidekick: an/aus, Status, Schwellen, Wartungs-Hinweise',
  cmdSavings: 'Sidekick: Kosten und geschätzte Ersparnis',
  // Cache-Zustand
  cacheUnknown: 'unbekannt',
  cacheCold: (span: string) => `kalt seit ${span}`,
  cacheWarm: (span: string) => `warm, noch ${span}`,
  // /savings
  titleToday: (d: string) => `Heute (${d})`,
  titleWeek: (a: string, b: string) => `Woche (${a}–${b})`,
  titleAll: 'Gesamt',
  costLine: (cost: string, saved: string, ratio: string) => `**Kosten** ${cost} · **Ersparnis (Schätzung)** ${saved} · **Verhältnis** ${ratio}`,
  itemsHead: '| Posten | Anzahl | ≈ $ | Rechenweise |',
  itemsHeadShort: '| Posten | Anzahl | ≈ $ |',
  detailWord: 'Details',
  moreHint: '*Modelle, Vergleich, Tage und Rechenweise: `/savings detail`*',
  compareHead: '| Prüfung mit | Anzahl | Ø je Prüfung | Ø Dauer | Faktor | genutzt |',
  compareMixed: 'früher: vor 0.5.0 ohne Modell gebucht (bis 0.3 Haiku, ab 0.4 schon Sonnet). Der Betrag enthält auch die damaligen Übergaben, der Preis je Prüfung ist daher eine Obergrenze (≤); ein Faktor dazu ist eine Grenze (≥ mindestens, ≤ höchstens).',
  daysHead: '| Tag | Prüfungen | Kosten | Ersparnis | Modelle (Aufrufe) |',
  daysMore: (n: number) => `… und ${n} ältere ${n === 1 ? 'Tag' : 'Tage'}`,
  rowColdAvoided: (n: number, usd: string) => `| Kaltstart vermieden | ${n} | ${usd} | 1. Anfrage: Kontext alt × Schreibpreis − (gelesen × Lesepreis + geschrieben × Schreibpreis); danach je Anfrage max(0, Kontext alt − 1. Anfrage) × Lesepreis, bis zur alten Größe, ≤ 50 Anfragen |`,
  rowWarmNew: (n: number, usd: string) => `| Neuer Chat bei warmem großem Kontext | ${n} | ${usd} | 1. Anfrage: Kontext alt × Lesepreis − (gelesen × Lesepreis + geschrieben × Schreibpreis); danach je Anfrage max(0, Kontext alt − 1. Anfrage) × Lesepreis, bis zur alten Größe, ≤ 50 Anfragen |`,
  rowAccepted: (art: string, n: number) => `| ${art} angenommen | ${n} | – | nur gezählt, nicht belegbar |`,
  counts: '**Zählungen**',
  checks: (n: number, wait: string) => `- Prüfungen: **${n}** · mittlere Wartezeit **${wait}**`,
  modelsHead: '| Modell | Rolle | Aufrufe | ≈ $ | je Aufruf | Ø Dauer | genutzt |',
  role: { pruefung: 'Prüfung', uebergabe: 'Übergabe' },
  rowEarlier: (n: number, usd: string, used: string) => `| früher, ohne Modell | – | ${n || '–'} | ${usd} | – | – | ${used} |`,
  hintsHead: '| Hinweis | gezeigt | angenommen | ignoriert | abgebrochen |',
  noHints: '- Hinweise: keine',
  wartungHead: '| Wartung | gezeigt | angenommen |',
  handoffs: (n: number, m: number) => `- Übergaben: **${n}** · Modellhinweise: **${m}**`,
  coldWithout: (n: number, usd: string) => `- Kaltstarts ohne Rückfrage: **${n}**${n ? ` · ${usd} Neuschreiben` : ''}`,
  skillsUsed: (list: string) => `- Skills genutzt: ${list || 'keine'} · \`/skill-doctor\` zeigt, was sich abschalten lässt`,
  savingsFoot: '*Beträge sind API-Wert; auf dem Abo zählt es aufs Kontingent. Die Ersparnis ist eine vorsichtige Schätzung. Kosten des eingebauten `cc-plugin-you-should-know` erfasst der Sidekick nicht.*',
  art: { neuer_chat: 'Neuer Chat', falscher_chat: 'Falscher Chat', skill: 'Skill', fassung: 'Fassung', modell: 'Modell', sonstiges: 'Sonstiges' },
  // /savings als Zeichnung (view.ts)
  vCost: 'Kosten',
  vCostSub: (n: number, h: number) => `${n} ${n === 1 ? 'Prüfung' : 'Prüfungen'} · ${h} ${h === 1 ? 'Übergabe' : 'Übergaben'}`,
  vSaved: 'Ersparnis (Schätzung)',
  vSavedSub: (n: number) => `${n} Chatwechsel`,
  vRatio: 'Verhältnis',
  vRatioSub: 'Kosten : Ersparnis',
  vSavingsHead: 'Ersparnis',
  vColdAvoided: 'Kaltstart vermieden',
  vWarmNew: 'Neuer Chat, warm und groß',
  vFormula: 'Rechenweise: 1. Anfrage im neuen Chat: alter Kontext × Preis − was sie wirklich kostet; danach je Anfrage (alt − 1. Anfrage) × Lesepreis, bis zur alten Größe, höchstens 50 Anfragen.',
  vAccepted: (list: string) => `Angenommen (nur gezählt): ${list}`,
  vModelsHead: 'Modelle (eigene Aufrufe)',
  vRoleLine: (role: string, n: number, avg: string, per: string) => `${role} ${n}× · Ø ${avg} · ${per} je Aufruf`,
  vTokens: (i: string, o: string) => `Tokens ${i} ein · ${o} aus`,
  vEarlier: 'früher',
  vEarlierNote: 'vor 0.5.0 ohne Modell gebucht (bis 0.3 Haiku, ab 0.4 Sonnet)',
  vNoModels: 'Noch keine Modellaufrufe.',
  vHintsHead: 'Hinweise',
  vHintCols: { art: 'Hinweis', gezeigt: 'gezeigt', angenommen: 'angenommen', ignoriert: 'ignoriert', abgebrochen: 'abgebrochen' },
  vWartungHead: 'Wartung',
  vCountsHead: 'Zählungen',
  vNone: 'keine',
  // Button unter der Zeile (Nachtrag 0.7.0)
  btnTodo: 'Als To-do',
  btnRun: (cmd: string) => `${cmd} ausführen`,
  btnRan: '✓ ausgeführt',
  btnBusy: '… läuft',
  btnQueued: '✓ als To-do eingereiht',
  todoText: (cmd: string) => `Führe ${cmd} aus.`,
  runFailed: (cmd: string, err: string) => `${cmd} ließ sich nicht starten (${err}).`,
  runFailedFilled: (cmd: string, err: string) => `${cmd} ließ sich nicht starten (${err}). Er steht im Eingabefeld, Enter schickt ihn ab.`,
  todoFailed: (cmd: string, err: string) => `To-do nicht angelegt (${err}). Befehl: ${cmd}`,
  vMore: 'Mehr: /savings detail · Modelle, Vergleich, Tage, Hinweise',
  vSpan: (a: string, b: string, n: number) => `Daten ${a === b ? 'vom ' + a : a + '–' + b} · an ${n} ${n === 1 ? 'Tag' : 'Tagen'}`,
  vUsed: (span: string, n: number) => `genutzt ${span} · an ${n} ${n === 1 ? 'Tag' : 'Tagen'}`,
  vCompareHead: 'Vergleich der Prüfung',
  vCompareCols: { model: 'Modell', n: 'Anzahl', per: 'Ø je Prüfung', time: 'Ø Dauer', factor: 'Faktor' },
  vCompareTokens: (i: string, o: string, perCall: boolean) => `Ø ${i} Tokens ein · ${o} aus ${perCall ? 'je Aufruf (Prüfung und Übergabe)' : 'je Prüfung'}`,
  vCompareNote: 'Faktor: Preis je Prüfung im Verhältnis zum günstigsten Modell.',
  vDaysHead: 'Verlauf je Tag',
  vDaysMore: (n: number) => `… und ${n} ältere ${n === 1 ? 'Tag' : 'Tage'}`,
  // Wartungs-Hinweise
  wSkillsCut: (inc: number, tot: number, cmd: string) => `Skill-Liste gekürzt: Claude sieht ${inc} von ${tot} Skills → ${cmd}`,
  wAuditNever: (tokens: string, cmd: string) => `Anweisungen ≈ ${tokens} Tokens, prompt-audit lief hier noch nie → ${cmd} (eigener Chat)`,
  wAuditGrown: (date: string, pct: number, cmd: string) => `Anweisungen seit dem Audit vom ${date} um ${pct} % gewachsen → ${cmd}`,
  wAuditModel: (model: string, cmd: string) => `Seit dem letzten Audit neues Modell (${model}) → ${cmd}`,
  wMemoryFull: (tokens: string, cmd: string) => `Memory-Index nahe der Ladegrenze (≈ ${tokens} Tokens) → ${cmd}`,
  wMemoryNever: (tokens: string, cmd: string) => `Memory-Index ≈ ${tokens} Tokens, nie aufgeräumt → ${cmd}`,
  wMemoryGrown: (date: string, pct: number, cmd: string) => `Memory-Index seit ${date} um ${pct} % gewachsen → ${cmd}`,
  wSkillsHeavy: (n: number, days: number, tokens: string, cmd: string) => `${n} Skills seit ${days} Tagen ungenutzt, Liste ≈ ${tokens} Tokens → ${cmd}`,
  wInit: (days: number, cmd: string) => `Noch keine CLAUDE.md in diesem Projekt (Chats an ${days} Tagen) → ${cmd}`,
  rule: { 'skills-cut': 'Skill-Liste gekürzt', audit: 'prompt-audit', memory: 'Memory aufräumen', 'skills-heavy': 'ungenutzte Skills', init: 'CLAUDE.md anlegen' },
  hintsTitle: (on: string, key: string) => `**Wartungs-Hinweise** ${on} · Projekt \`${key || 'unbekannt'}\``,
  hintsHeadRow: '| Regel | Messwert | erledigt | gezeigt | frühestens wieder |',
  vSkillsCut: (inc: number, tot: number) => `${inc} von ${tot} Skills`,
  vAudit: (tokens: string, min: string) => `${tokens} (ab ${min})`,
  vNoIndex: 'kein Index',
  vHeavy: (tokens: string, unused: string, days: number) => `${tokens}, ${unused} ungenutzt, Zählung seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}`,
  vHasClaudeMd: 'CLAUDE.md vorhanden',
  vNoClaudeMd: (days: number) => `keine CLAUDE.md, Chats an ${days} Tagen`,
  ruleOff: ' (aus)',
  cmdMissing: ' (Befehl fehlt)',
  now: 'jetzt',
  hintsUsage: (rules: string) => `\`/sidekick hints on|off\` · \`status\` · \`<regel> on|off\` · \`done <regel>\` · \`audit-min 3k\` (Regeln: ${rules})`,
  auditMinNeedsNumber: 'audit-min braucht eine Zahl, z. B. 2k',
  unknownRule: (r: string) => `Unbekannte Regel „${r}“`,
  unknownHints: (a: string) => `Unbekannt: „${a}“`,
  possible: (u: string) => `Möglich: ${u}`,
  // Kein sichtbarer Text: Name der Ausgabesprache im (deutschen) Prompt der Prüfung, deshalb auch bei en ein deutsches Wort
  outLang: 'Deutsch',
}

type Texts = typeof de

const en: Texts = {
  send: 'Send anyway',
  fassung: `Send ${CHECK_NAME}'s version`,
  newChat: 'New chat with handoff',
  newPlain: 'New chat without handoff',
  abort: 'Cancel',
  recommended: ' (recommended)',
  coldUnknown: (ctx, usd) => `Cache state unknown: sidekick sees this chat for the first time, ${ctx} context. If it is cold, sending rewrites everything (${usd}).`,
  coldSince: (span, ctx, usd) => `Cache cold for ${span}, ${ctx} context. Sending rewrites everything (${usd}).`,
  optNew: (label, usd) => `${label}: ${usd} (${HANDOFF_NAME} handoff and a small new chat).`,
  optPlain: (label, usd) => `${label}: ${usd} (only your message, if it doesn't need the old history).`,
  howNext: 'How do you want to continue?',
  fassungBlock: (f) => `Version:\n"${f}"`,
  newTopicDefault: 'New topic: a fresh chat would be cheaper here.',
  fassungDefault: `${CHECK_NAME} has a clearer version.`,
  wrongChat: (zeile, cold) => `This doesn't fit this chat at all.${zeile ? `\n\n${zeile}` : ''}${cold ? `\n\n${cold}` : ''}\n\nCancel sends nothing; your text stays ready to copy. Are you in the wrong chat?`,
  busyHandoff: 'is writing the handoff',
  busyPlain: 'is starting a new chat',
  busyClear: 'is clearing the chat and sending',
  tooShort: 'too short',
  handoffFailed: (why) => `The handoff could not be written (${why}). Send the message in this chat anyway?`,
  notSent: (t) => `Not sent. Your text: "${t}"`,
  clearFailedSaved: (err) => `/clear failed (${err}). Handoff and message are saved: /sidekick status.`,
  clearFailedNothing: (err, t) => `/clear failed (${err}). Nothing sent. Your text: "${t}"`,
  newChatStarted: (withHandoff) => `New chat ${withHandoff ? 'with' : 'without'} handoff started. The old chat stays available via /resume.`,
  sendAfterClearFailed: (err, rest) => `Chat cleared, but the message could not be sent (${err}). ${rest}`,
  statusShowsHandoff: '/sidekick status shows the handoff and the message.',
  yourText: (t) => `Your text: "${t}"`,
  newChatFailed: (err, t) => `New chat failed (${err}). Nothing sent. Your text: "${t}"`,
  dropStarting: (plain, t) => `sidekick: ${plain ? 'A new chat is starting' : `${HANDOFF_NAME} is writing the handoff, then a new chat starts`} with your message:\n\n${t}`,
  dropAborted: (t) => `sidekick: not sent. Your text to copy:\n\n${t}`,
  dropWrongChat: (t) => `sidekick: not sent (wrong chat?). Your text to copy:\n\n${t}`,
  handoffSep: '\n\n---\n\nMy next message:\n\n',
  sentFassung: `${CHECK_NAME}'s version was sent`,
  sentLabel: 'sent:',
  sentPlain: (s) => `\n\nsent: "${s}"`,
  on: 'on',
  off: 'off',
  statusTitle: (on) => `**${on}** · status`,
  rowThreshold: (v) => `| **Threshold** | ${v} context (checks from here) |`,
  rowBig: (v) => `| **Big** | ${v} (asks when the cache is cold) |`,
  rowSkills: (on) => `| **Skills to ${CHECK_NAME}** | ${on} |`,
  rowTtl: (ttl, src) => `| **Cache lifetime** | ${ttl} min (${src}) |`,
  ttlSet: 'set',
  ttlDefault: 'default',
  ttlMeasured: 'measured',
  rowCtx: (ctx, cache) => `| **Context** | ${ctx} · cache ${cache} |`,
  summary: (s) => `**Summary:** ${s || 'none yet'}`,
  lastHint: (s) => `**Last hint:** ${s || 'none'}`,
  lastHandoff: (time) => `**Last handoff** (${time}):`,
  handoffMsg: (m) => `**Message with it:** ${m}`,
  noHandoff: '**Last handoff:** none',
  hintsLine: (on, off) => `**Maintenance hints:** ${on}${off ? ` (off: ${off})` : ''} · details: \`/sidekick hints status\``,
  change: (u) => `Change: ${u}`,
  unknownArg: (a, u) => `Unknown: "${a}". Possible: ${u}`,
  savingsUsage: 'Usage: `/savings [today|week|all]` (short) or `/savings detail [today|week|all]` (everything, default: all time)',
  hintsNoMeasure: (on, u) => `Maintenance hints ${on}. No measurements here (no breakdown or no project).\n\nChange: ${u}`,
  cmdSidekick: 'Sidekick: on/off, status, thresholds, maintenance hints',
  cmdSavings: 'Sidekick: cost and estimated savings',
  cacheUnknown: 'unknown',
  cacheCold: (span) => `cold for ${span}`,
  cacheWarm: (span) => `warm, ${span} left`,
  titleToday: (d) => `Today (${d})`,
  titleWeek: (a, b) => `Week (${a}–${b})`,
  titleAll: 'All time',
  costLine: (cost, saved, ratio) => `**Cost** ${cost} · **Savings (estimate)** ${saved} · **Ratio** ${ratio}`,
  itemsHead: '| Item | Count | ≈ $ | How it is computed |',
  itemsHeadShort: '| Item | Count | ≈ $ |',
  detailWord: 'details',
  moreHint: '*Models, comparison, days and how it is computed: `/savings detail`*',
  compareHead: '| Check by | Count | avg per check | avg time | factor | used |',
  compareMixed: 'earlier: booked before 0.5.0 without a model (Haiku until 0.3, already Sonnet from 0.4). The amount also includes the handoffs of that time, so the price per check is an upper bound (≤); a factor against it is a bound (≥ at least, ≤ at most).',
  daysHead: '| Day | Checks | Cost | Savings | Models (calls) |',
  daysMore: (n) => `… and ${n} older ${n === 1 ? 'day' : 'days'}`,
  rowColdAvoided: (n, usd) => `| Cold start avoided | ${n} | ${usd} | 1st request: old context × write price − (read × read price + written × write price); then per request max(0, old context − 1st request) × read price, until the old size, ≤ 50 requests |`,
  rowWarmNew: (n, usd) => `| New chat at warm large context | ${n} | ${usd} | 1st request: old context × read price − (read × read price + written × write price); then per request max(0, old context − 1st request) × read price, until the old size, ≤ 50 requests |`,
  rowAccepted: (art, n) => `| ${art} accepted | ${n} | – | counted only, not provable |`,
  counts: '**Counts**',
  checks: (n, wait) => `- Checks: **${n}** · average wait **${wait}**`,
  modelsHead: '| Model | Role | Calls | ≈ $ | per call | avg time | used |',
  role: { pruefung: 'Check', uebergabe: 'Handoff' },
  rowEarlier: (n, usd, used) => `| earlier, no model | – | ${n || '–'} | ${usd} | – | – | ${used} |`,
  hintsHead: '| Hint | shown | accepted | ignored | cancelled |',
  noHints: '- Hints: none',
  wartungHead: '| Maintenance | shown | accepted |',
  handoffs: (n, m) => `- Handoffs: **${n}** · model hints: **${m}**`,
  coldWithout: (n, usd) => `- Cold starts without asking: **${n}**${n ? ` · ${usd} rewrite` : ''}`,
  skillsUsed: (list) => `- Skills used: ${list || 'none'} · \`/skill-doctor\` shows what can be turned off`,
  savingsFoot: '*Amounts are API value; on a subscription it counts toward your plan. Savings are a cautious estimate. sidekick does not track the cost of the built-in `cc-plugin-you-should-know`.*',
  art: { neuer_chat: 'New chat', falscher_chat: 'Wrong chat', skill: 'Skill', fassung: `${CHECK_NAME}'s version`, modell: 'Model', sonstiges: 'Other' },
  vCost: 'Cost',
  vCostSub: (n, h) => `${n} ${n === 1 ? 'check' : 'checks'} · ${h} ${h === 1 ? 'handoff' : 'handoffs'}`,
  vSaved: 'Savings (estimate)',
  vSavedSub: (n) => `${n} chat ${n === 1 ? 'switch' : 'switches'}`,
  vRatio: 'Ratio',
  vRatioSub: 'cost : savings',
  vSavingsHead: 'Savings',
  vColdAvoided: 'Cold start avoided',
  vWarmNew: 'New chat, warm and large',
  vFormula: 'How: 1st request in the new chat: old context × price − what it really cost; then per request (old − 1st request) × read price, until the old size, at most 50 requests.',
  vAccepted: (list) => `Accepted (counted only): ${list}`,
  vModelsHead: 'Models (own calls)',
  vRoleLine: (role, n, avg, per) => `${role} ${n}× · avg ${avg} · ${per} per call`,
  vTokens: (i, o) => `Tokens ${i} in · ${o} out`,
  vEarlier: 'earlier',
  vEarlierNote: 'booked before 0.5.0 without a model (Haiku until 0.3, Sonnet from 0.4)',
  vNoModels: 'No model calls yet.',
  vHintsHead: 'Hints',
  vHintCols: { art: 'Hint', gezeigt: 'shown', angenommen: 'accepted', ignoriert: 'ignored', abgebrochen: 'cancelled' },
  vWartungHead: 'Maintenance',
  vCountsHead: 'Counts',
  vNone: 'none',
  btnTodo: 'Add as to-do',
  btnRun: (cmd) => `Run ${cmd}`,
  btnRan: '✓ ran',
  btnBusy: '… running',
  btnQueued: '✓ queued as to-do',
  todoText: (cmd) => `Run ${cmd}.`,
  runFailed: (cmd, err) => `${cmd} could not be started (${err}).`,
  runFailedFilled: (cmd, err) => `${cmd} could not be started (${err}). It is in the prompt box, Enter sends it.`,
  todoFailed: (cmd, err) => `To-do not added (${err}). Command: ${cmd}`,
  vMore: 'More: /savings detail · models, comparison, days, hints',
  vSpan: (a, b, n) => `Data ${a === b ? 'from ' + a : a + '–' + b} · on ${n} ${n === 1 ? 'day' : 'days'}`,
  vUsed: (span, n) => `used ${span} · on ${n} ${n === 1 ? 'day' : 'days'}`,
  vCompareHead: 'Checks compared',
  vCompareCols: { model: 'Model', n: 'Count', per: 'avg per check', time: 'avg time', factor: 'factor' },
  vCompareTokens: (i, o, perCall) => `avg ${i} tokens in · ${o} out ${perCall ? 'per call (check and handoff)' : 'per check'}`,
  vCompareNote: 'Factor: price per check relative to the cheapest model.',
  vDaysHead: 'By day',
  vDaysMore: (n) => `… and ${n} older ${n === 1 ? 'day' : 'days'}`,
  wSkillsCut: (inc, tot, cmd) => `Skill list cut short: Claude sees ${inc} of ${tot} skills → ${cmd}`,
  wAuditNever: (tokens, cmd) => `Instructions ≈ ${tokens} tokens, prompt-audit never ran here → ${cmd} (separate chat)`,
  wAuditGrown: (date, pct, cmd) => `Instructions grew ${pct}% since the audit on ${date} → ${cmd}`,
  wAuditModel: (model, cmd) => `New model since the last audit (${model}) → ${cmd}`,
  wMemoryFull: (tokens, cmd) => `Memory index close to the load limit (≈ ${tokens} tokens) → ${cmd}`,
  wMemoryNever: (tokens, cmd) => `Memory index ≈ ${tokens} tokens, never cleaned up → ${cmd}`,
  wMemoryGrown: (date, pct, cmd) => `Memory index grew ${pct}% since ${date} → ${cmd}`,
  wSkillsHeavy: (n, days, tokens, cmd) => `${n} skills unused for ${days} days, list ≈ ${tokens} tokens → ${cmd}`,
  wInit: (days, cmd) => `No CLAUDE.md in this project yet (chats on ${days} days) → ${cmd}`,
  rule: { 'skills-cut': 'Skill list cut short', audit: 'prompt-audit', memory: 'Clean up memory', 'skills-heavy': 'Unused skills', init: 'Create CLAUDE.md' },
  hintsTitle: (on, key) => `**Maintenance hints** ${on} · project \`${key || 'unknown'}\``,
  hintsHeadRow: '| Rule | Measured | done | shown | next possible |',
  vSkillsCut: (inc, tot) => `${inc} of ${tot} skills`,
  vAudit: (tokens, min) => `${tokens} (from ${min})`,
  vNoIndex: 'no index',
  vHeavy: (tokens, unused, days) => `${tokens}, ${unused} unused, counting for ${days} ${days === 1 ? 'day' : 'days'}`,
  vHasClaudeMd: 'CLAUDE.md present',
  vNoClaudeMd: (days) => `no CLAUDE.md, chats on ${days} days`,
  ruleOff: ' (off)',
  cmdMissing: ' (command missing)',
  now: 'now',
  hintsUsage: (rules) => `\`/sidekick hints on|off\` · \`status\` · \`<rule> on|off\` · \`done <rule>\` · \`audit-min 3k\` (rules: ${rules})`,
  auditMinNeedsNumber: 'audit-min needs a number, e.g. 2k',
  unknownRule: (r) => `Unknown rule "${r}"`,
  unknownHints: (a) => `Unknown: "${a}"`,
  possible: (u) => `Possible: ${u}`,
  outLang: 'Englisch',
}

export const T: Readonly<Record<Lang, Texts>> = { en, de }

/** Die Texte der eingestellten Sprache. */
export const t = (): Texts => T[LANG]
