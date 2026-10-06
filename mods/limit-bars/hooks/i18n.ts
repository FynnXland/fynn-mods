// limit-bars: Texte en/de und Formatierer, ohne `$`. Die Sprache kommt aus `userConfig.language` (Standard en, release/I18N.md).
// Beide Tabellen haben dieselben Schlüssel; Funktionen bekommen nur fertig formatierte Teile (Zahlen, Zeiten, Beträge).
// Befehle und Argumente sind in beiden Sprachen englisch; die deutschen Argumente gelten weiter als Alias (cache.ts, register.ts).

export type Lang = 'en' | 'de'

export function langOf(v: unknown): Lang {
  return v === 'de' ? 'de' : 'en'
}

const two = (n: number) => String(n).padStart(2, '0')

/** Uhrzeit `14:30` in lokaler Zeit; in beiden Sprachen gleich. */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Dezimalzahl: en `1.5`, de `1,5`. */
export function dec(n: number, digits: number, lang: Lang): string {
  const s = n.toFixed(digits)
  return lang === 'de' ? s.replace('.', ',') : s
}

/** API-Wert in Dollar: en `≈ $3.30`, `< $0.01`; de `≈ 3,30 $`, `< 0,01 $`. */
export function usd(v: number, lang: Lang): string {
  const amount = (s: string) => (lang === 'de' ? `${s} $` : `$${s}`)
  if (!(v > 0)) return `≈ ${amount('0')}`
  if (v < 0.01) return `< ${amount(dec(0.01, 2, lang))}`
  return `≈ ${amount(dec(v, 2, lang))}`
}

const en = {
  // Balken
  fiveName: '5-hour limit',
  weekName: 'Weekly limit',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  dayUnit: 'd',
  pct: (n: string) => `${n}%`,
  full: 'full',
  fresh: 'fresh',
  freshAlt: 'just reset',
  unknown: 'not known yet',
  resetAlt: (when: string) => `resets ${when}`,

  // Dauer und Cache-Zustand
  underMinute: 'under 1 min',
  underMinuteLong: 'less than a minute',
  cold: 'cold',
  state: { unknown: 'not known yet', warm: 'warm', cooling: 'cooling down', cold: 'cold', kept: 'being kept warm' },
  ringUnknownAlt: 'Cache not known yet (no request yet)',
  ringCtxAlt: (tokens: string) => `, context ${tokens} tokens`,
  ringColdAlt: 'Cache cold',
  ringLeftAlt: (word: string, span: string) => `Cache ${word}, ${span} left`,

  // /cache
  repTitle: (word: string) => `### Prompt cache · ${word}`,
  repUnknown: 'No request in this chat yet. The ring starts with the first reply.',
  repColdSince: (span: string) => `**cold for ${span}**`,
  repLeft: (span: string, at: string) => `**${span} left** · until ${at}`,
  repTtl: 'Cache duration',
  srcSet: 'set by you',
  srcMeasured: 'measured',
  srcDefault: 'default',
  repModel: 'Model',
  repContext: 'Context',
  repTokens: (n: string) => `${n} tokens`,
  repBig: ' · big',
  repNext: 'Next message',
  repNextValue: (warm: string, cold: string) => `warm ${warm} · cold (rewrite) ${cold}`,
  repLast: 'Last request',
  repLastValue: (at: string, read: string, written: string) => `${at} · ${read} read from the cache, ${written} written`,
  repCold: 'Cold restarts',
  repColdValue: (n: string, cost: string) => `${n}${cost} this session`,
  repSession: 'Session so far',
  repSessionValue: (cost: string) => `${cost} (as in /cost)`,
  repKeep: 'Keep-warm',
  repKeepOn: (until: string, pings: string, cost: string, perPing: string) => `on until ${until} · ${pings} ping(s) ${cost} · ${perPing} per ping`,
  on: 'on',
  off: 'off',
  repSettings: '**Settings**',
  repGuard: (state: string, from: string) => `- Question before a cold send: **${state}** from ${from}`,
  repAlerts: (state: string) => `- Notice shortly before expiry: **${state}**`,
  repChange: 'Change',
  repCommands: '**Commands**',
  repKeepStop: 'stops keep-warm',
  repKeepStart: (every: string) => `keeps the cache warm (at most 4 h, one ping every ~${every})`,
  repHandoff: 'writes a handoff for a fresh chat',
  repHandoffLast: (at: string) => `last ${at}`,
  repFooter: '*Amounts are API value; on a subscription it counts against your quota.*',
  saved: 'Saved.',
  notSaved: 'Applies until restart (saving was refused).',
  unknownArg: (arg: string, possible: string) => `Unknown: "${arg}". Possible: ${possible}`,

  // Befehle registrieren
  cmdCache: 'Prompt cache: state, cost, settings',
  cmdHandoff: 'Write a handoff, then clear the chat and continue with it',
  cmdKeepwarm: 'Keep the prompt cache warm (costs quota), at most 4 h',
  hintKeepwarm: '[hours|off]',
  hoursArg: '[hours]',

  // Rückfrage vor kaltem Senden
  guardQuestion: (since: string, tokens: string, cold: string, warm: string) =>
    `The cache has been cold for ${since}. Sending rewrites ${tokens} tokens (${cold} API value; warm it would be ${warm}). ` +
    'Compacting also reads everything once and saves little now. How to continue?',
  send: 'Send anyway',
  compact: 'Compact first',
  abort: 'Cancel',
  abortToast: 'Not sent. New topic: new chat. Same work: just send, or /handoff for a small fresh chat.',
  dropAbort: 'limit-bars: cancelled before rewriting the cold cache',
  dropCompact: 'limit-bars: will be sent after compacting',
  compactFailed: (err: string) => `Compacting failed (${err}); sending without.`,
  resendFailed: (err: string, text: string) => `Message could not be sent (${err}): "${text}"`,

  // Hinweis kurz vor Ablauf
  alert: (span: string, ctx: string, cost: string) =>
    `Cache expires in ${span} (${ctx} context, rewrite ${cost}). ` +
    'Continuing right away: just write. Stopping: /handoff now, while it is cheap. Coming back to this chat later: /keepwarm.',

  // Übergabe
  handoffHeader: 'Handoff',
  handoffQuestion:
    'Handoff ready. "New chat with handoff" clears this chat (/clear, it stays reachable via /resume) and sends the handoff as the first message; the cache then starts small. Start a new chat?',
  clearGo: 'New chat with handoff',
  keepChat: 'Keep working here',
  handoffSavedLater: 'Handoff saved. Later: /handoff continue (clears the chat) or /handoff show.',
  handoffEmpty: 'The handoff turn ended without a handoff; nothing saved.',
  handoffNone: 'No handoff yet. Run /handoff first.',
  handoffBusy: 'Claude is still working. /handoff continue once the turn is done.',
  handoffPrefix: 'Handoff from my previous chat:',
  clearFailed: (err: string) => `/clear failed (${err}). The handoff is saved: /handoff show prints it.`,
  handoffStarted: 'New chat started with the handoff. The old chat stays reachable via /resume.',
  handoffSendFailed: 'Chat cleared, but the handoff could not be sent. /handoff show prints it.',
  handoffLast: (at: string, text: string) => `Last handoff (${at}):\n\n${text}`,
  handoffNoneSaved: 'No handoff saved yet.',
  handoffContinuing: 'Clearing the chat and continuing with the handoff.',
  handoffRunning: 'A handoff is already running.',
  skillMissing: 'skill "uebergabe" not loaded (/reload-plugins)',
  handoffStartFailed: (err: string) => `Could not start the handoff: ${err}`,
  handoffWriting: 'Writing the handoff (skill "uebergabe"). Afterwards you can clear the chat and continue with it.',

  // Warmhalten
  keepOff: (why: string, pings: string, cost: string) => `Keep-warm off (${why}). ${pings} ping(s), ${cost} API value.`,
  whyNewChat: 'new chat',
  whyTimeUp: 'time is up',
  whyWasCold: 'the cache was already cold',
  whyNoRead: 'the ping read nothing from the cache',
  whyNoReply: (reason: string) => `the ping got no reply (${reason})`,
  whyRewrote: (tokens: string) => `the ping wrote ${tokens} tokens instead of reading the cache`,
  whyFailed: (err: string) => `ping failed: ${err}`,
  whyTurnedOff: 'turned off',
  keepAlreadyOff: 'Keep-warm is already off.',
  keepTurnedOff: 'Keep-warm off.',
  keepUsage: (max: string) => `Usage: /keepwarm [hours|off], at most ${max} h.`,
  keepNothing: 'No request in this chat yet, so nothing to keep warm.',
  keepCold: 'The cache is already cold. Keeping it warm would first rewrite it; the next message does that anyway.',
  keepOn: (until: string, capped: string, lead: string, perPing: string, ctx: string, pings: string) =>
    `Keep-warm on until ${until}${capped}. A ping reads the cache about ${lead} before it expires: ${perPing} API value per ping at ${ctx} context, ` +
    `so about ${pings} pings. If a ping rewrites instead of reading, keep-warm turns itself off. Off: /keepwarm off`,
  keepCapped: (max: string) => ` (at most ${max} h)`,
}

export type Texts = typeof en

const de: Texts = {
  fiveName: '5-Stunden-Limit',
  weekName: 'Wochenlimit',
  weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  dayUnit: 'T',
  pct: (n) => `${n} %`,
  full: 'voll',
  fresh: 'frisch',
  freshAlt: 'gerade zurückgesetzt',
  unknown: 'noch unbekannt',
  resetAlt: (when) => `Reset ${when}`,

  underMinute: 'unter 1 min',
  underMinuteLong: 'unter einer Minute',
  cold: 'kalt',
  state: { unknown: 'noch unbekannt', warm: 'warm', cooling: 'kühlt ab', cold: 'kalt', kept: 'wird warmgehalten' },
  ringUnknownAlt: 'Cache noch unbekannt (noch keine Anfrage)',
  ringCtxAlt: (tokens) => `, Kontext ${tokens} Tokens`,
  ringColdAlt: 'Cache kalt',
  ringLeftAlt: (word, span) => `Cache ${word}, noch ${span}`,

  repTitle: (word) => `### Prompt-Cache · ${word}`,
  repUnknown: 'Noch keine Anfrage in diesem Chat. Der Ring startet mit der ersten Antwort.',
  repColdSince: (span) => `**kalt seit ${span}**`,
  repLeft: (span, at) => `**noch ${span}** · bis ${at}`,
  repTtl: 'Cache-Dauer',
  srcSet: 'von dir gesetzt',
  srcMeasured: 'gemessen',
  srcDefault: 'Standard',
  repModel: 'Modell',
  repContext: 'Kontext',
  repTokens: (n) => `${n} Tokens`,
  repBig: ' · groß',
  repNext: 'Nächste Nachricht',
  repNextValue: (warm, cold) => `warm ${warm} · kalt (Neuschreiben) ${cold}`,
  repLast: 'Letzte Anfrage',
  repLastValue: (at, read, written) => `${at} · ${read} aus dem Cache gelesen, ${written} neu geschrieben`,
  repCold: 'Kalte Neustarts',
  repColdValue: (n, cost) => `${n}${cost} in dieser Sitzung`,
  repSession: 'Sitzung bisher',
  repSessionValue: (cost) => `${cost} (wie /cost)`,
  repKeep: 'Warmhalten',
  repKeepOn: (until, pings, cost, perPing) => `an bis ${until} · ${pings} Ping(s) ${cost} · je Ping ${perPing}`,
  on: 'an',
  off: 'aus',
  repSettings: '**Einstellungen**',
  repGuard: (state, from) => `- Rückfrage vor kaltem Senden: **${state}** ab ${from}`,
  repAlerts: (state) => `- Hinweis kurz vor Ablauf: **${state}**`,
  repChange: 'Ändern',
  repCommands: '**Befehle**',
  repKeepStop: 'beendet das Warmhalten',
  repKeepStart: (every) => `hält den Cache warm (höchstens 4 h, ein Ping je ~${every})`,
  repHandoff: 'schreibt eine Übergabe für einen frischen Chat',
  repHandoffLast: (at) => `letzte ${at}`,
  repFooter: '*Beträge sind API-Wert; auf dem Abo zählt es aufs Kontingent.*',
  saved: 'Gespeichert.',
  notSaved: 'Gilt bis zum Neustart (Speichern abgelehnt).',
  unknownArg: (arg, possible) => `Unbekannt: „${arg}“. Möglich: ${possible}`,

  cmdCache: 'Prompt-Cache: Zustand, Kosten, Einstellungen',
  cmdHandoff: 'Übergabe schreiben, danach Chat leeren und damit weitermachen',
  cmdKeepwarm: 'Prompt-Cache warmhalten (kostet Kontingent), höchstens 4 h',
  hintKeepwarm: '[stunden|off]',
  hoursArg: '[stunden]',

  guardQuestion: (since, tokens, cold, warm) =>
    `Der Cache ist seit ${since} kalt. Senden schreibt ${tokens} Tokens neu (${cold} API-Wert; warm wären es ${warm}). ` +
    'Komprimieren liest dafür auch einmal alles und spart jetzt kaum. Wie weiter?',
  send: 'Trotzdem senden',
  compact: 'Erst komprimieren',
  abort: 'Abbrechen',
  abortToast: 'Nicht gesendet. Neues Thema: neuer Chat. Gleiche Arbeit: einfach senden, oder /handoff für einen kleinen frischen Chat.',
  dropAbort: 'limit-bars: vor dem Neuschreiben des kalten Caches abgebrochen',
  dropCompact: 'limit-bars: wird nach dem Komprimieren gesendet',
  compactFailed: (err) => `Komprimieren ging nicht (${err}); sende ohne.`,
  resendFailed: (err, text) => `Nachricht ließ sich nicht senden (${err}): „${text}“`,

  alert: (span, ctx, cost) =>
    `Cache läuft in ${span} ab (${ctx} Kontext, Neuschreiben ${cost}). ` +
    'Machst du gleich weiter: einfach schreiben. Hörst du auf: jetzt /handoff, solange es günstig ist. Kommst du später in diesen Chat zurück: /keepwarm.',

  handoffHeader: 'Übergabe',
  handoffQuestion:
    'Übergabe fertig. „Neuer Chat mit Übergabe“ leert diesen Chat (/clear, er bleibt über /resume erreichbar) und schickt die Übergabe als erste Nachricht; der Cache startet dann klein. Neuen Chat starten?',
  clearGo: 'Neuer Chat mit Übergabe',
  keepChat: 'Hier weiterarbeiten',
  handoffSavedLater: 'Übergabe gespeichert. Später: /handoff continue (leert den Chat) oder /handoff show.',
  handoffEmpty: 'Der Übergabe-Turn endete ohne Übergabe; nichts gespeichert.',
  handoffNone: 'Noch keine Übergabe. Erst /handoff.',
  handoffBusy: 'Claude arbeitet noch. /handoff continue, sobald der Turn fertig ist.',
  handoffPrefix: 'Übergabe aus meinem vorigen Chat:',
  clearFailed: (err) => `/clear ging nicht (${err}). Die Übergabe ist gespeichert: /handoff show gibt sie aus.`,
  handoffStarted: 'Neuer Chat mit der Übergabe gestartet. Der alte Chat bleibt über /resume erreichbar.',
  handoffSendFailed: 'Chat geleert, aber die Übergabe ließ sich nicht senden. /handoff show gibt sie aus.',
  handoffLast: (at, text) => `Letzte Übergabe (${at}):\n\n${text}`,
  handoffNoneSaved: 'Noch keine Übergabe gespeichert.',
  handoffContinuing: 'Leere den Chat und mache mit der Übergabe weiter.',
  handoffRunning: 'Eine Übergabe läuft schon.',
  skillMissing: 'Skill „uebergabe“ nicht geladen (/reload-plugins)',
  handoffStartFailed: (err) => `Übergabe ließ sich nicht starten: ${err}`,
  handoffWriting: 'Erstelle die Übergabe (Skill „uebergabe“). Danach kannst du den Chat leeren und mit ihr weitermachen.',

  keepOff: (why, pings, cost) => `Warmhalten aus (${why}). ${pings} Ping(s), ${cost} API-Wert.`,
  whyNewChat: 'neuer Chat',
  whyTimeUp: 'Zeit abgelaufen',
  whyWasCold: 'der Cache war schon kalt',
  whyNoRead: 'der Ping las nichts aus dem Cache',
  whyNoReply: (reason) => `der Ping bekam keine Antwort (${reason})`,
  whyRewrote: (tokens) => `der Ping schrieb ${tokens} Tokens neu, statt den Cache zu lesen`,
  whyFailed: (err) => `Ping fehlgeschlagen: ${err}`,
  whyTurnedOff: 'ausgeschaltet',
  keepAlreadyOff: 'Warmhalten ist schon aus.',
  keepTurnedOff: 'Warmhalten aus.',
  keepUsage: (max) => `Aufruf: /keepwarm [stunden|off], höchstens ${max} h.`,
  keepNothing: 'Noch keine Anfrage in diesem Chat, also nichts warmzuhalten.',
  keepCold: 'Der Cache ist schon kalt. Warmhalten würde ihn erst neu schreiben; die nächste Nachricht macht das ohnehin.',
  keepOn: (until, capped, lead, perPing, ctx, pings) =>
    `Warmhalten an bis ${until}${capped}. Ein Ping liest den Cache etwa ${lead} vor Ablauf: ${perPing} API-Wert je Ping bei ${ctx} Kontext, ` +
    `also etwa ${pings} Pings. Schreibt ein Ping neu statt zu lesen, schaltet es sich ab. Aus: /keepwarm off`,
  keepCapped: (max) => ` (höchstens ${max} h)`,
}

export const T: Readonly<Record<Lang, Texts>> = { en, de }

/** Einstellungen von `/cache`, in Hilfe und Karte immer in der englischen Form (deutsche Aliase: cache.ts `applySetting`). */
export const CACHE_ARGS = 'ttl 5|60|auto · warn on|off · big 150k · hints on|off'
export const CACHE_HINT = '[ttl 5|60|auto] [warn on|off] [big 150k] [hints on|off]'
export const HANDOFF_HINT = '[continue|show]'
