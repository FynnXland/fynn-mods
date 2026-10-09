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

/** Ganze Zahl mit Tausendertrennung: en `562,932`, de `562.932`. */
export function int(n: number, lang: Lang): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'de' ? '.' : ',')
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
  unknownArg: (arg: string, possible: string) => `Unknown: "${arg}". Possible: ${possible} → \`/bars help\``,

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
  keepUsage: (max: string) => `Usage: /keepwarm [hours|off], at most ${max} h. → \`/bars help\``,
  keepNothing: 'No request in this chat yet, so nothing to keep warm.',
  keepCold: 'The cache is already cold. Keeping it warm would first rewrite it; the next message does that anyway.',
  keepOn: (until: string, capped: string, lead: string, perPing: string, ctx: string, pings: string) =>
    `Keep-warm on until ${until}${capped}. A ping reads the cache about ${lead} before it expires: ${perPing} API value per ping at ${ctx} context, ` +
    `so about ${pings} pings. If a ping rewrites instead of reading, keep-warm turns itself off. Off: /keepwarm off`,
  keepCapped: (max: string) => ` (at most ${max} h)`,

  // Speicher-Ring und /disk
  diskAlt: (drive: string, used: string, total: string) => `Drive ${drive} ${used} of ${total} used`,
  groups: {
    programs: 'Programs & libraries',
    media: 'Media',
    models: 'AI models & data',
    code: 'Code & text',
    archives: 'Archives & packages',
    other: 'Other',
  },
  diskFree: 'Free',
  cmdStorage: 'Drive usage by file type: ring with legend',
  storageOff: 'The storage ring is off. Set `storagePath` in /config, for example `E:\\`.',
  storageWindowsOnly: 'The storage ring works on Windows only for now: `storagePath` needs a drive letter, for example `E:\\`.',
  storageFailed: (drive: string, err: string) => `Could not read drive ${drive}: ${err}`,
  storageScanFailed: (err: string) => `Scan failed (${err}), showing the last result.`,
  storageTitle: (drive: string, used: string, total: string, pct: string) => `### Drive ${drive} · ${used} of ${total} used (${pct})`,
  storageScanned: (at: string, files: string) => `Scanned ${at} · ${files} files`,
  storageNoScan: 'Not scanned by file type yet.',
  storageHead: '| File type | Size | Share |',
  storageOfDrive: (pct: string) => `${pct} of the drive`,
  storageScanRunning: (at: string) => `Another session has been scanning the drive since ${at}. Run /disk again in a moment.`,
  storageScanPaused: (at: string) => `The last scan failed at ${at}; automatic scans pause for 24 h. Retry: /disk refresh`,
  errMissing: 'path not found',
  errUnreadable: 'folder not readable',
  errTruncated: 'output truncated',
  errNoData: 'no usable output',

  // /bars: Anzeige anpassen
  cmdBars: 'Show or hide parts of the display: 5h, week, cache, storage',
  barsTitle: '### limit-bars · display',
  barsHead: '| Part | Shown | Set by |',
  barsPart: { fiveHour: '5-hour bar', weekly: 'Weekly bar', cache: 'Cache ring', storage: 'Storage ring' },
  barsOn: 'on',
  barsOff: 'off',
  barsByCommand: '/bars',
  barsBySetting: 'settings',
  barsNoPath: 'on, but no `storagePath`',
  barsNotWindows: 'on, but `storagePath` has no drive letter',
  barsUsage: 'Change: `/bars show 5h|week|cache|storage on|off` · back to the settings: `/bars reset`. Applies to all open chats within 10 s.',
  barsSet: (part: string, state: string) => `${part}: ${state}. Applies to all open chats within 10 s; \`/bars reset\` goes back to the settings.`,
  barsReset: 'Back to the settings (`/config` → limit-bars).',
  barsCacheNote: 'The cold-send question and the notices stay on; turn them off with `/cache warn off` and `/cache hints off`.',
  barsSaveFailed: (err: string) => `Could not save (${err}); applies to this chat only until it restarts.`,

  // /bars help (docs/HELP-SPEC.md §5 „limit-bars 0.7.0“); Abschnittsüberschriften und „an/aus“ stehen in help.ts
  seeHelp: 'All commands: `/bars help`',
  help: {
    intro: 'Usage limits as bars above the prompt, a ring for the prompt cache and an optional storage ring. The cache guard asks before an expensive cold send.',
    bars: 'which parts of the display are shown',
    barsShow: 'show or hide a part, in all open chats within 10 s (also without show)',
    barsReset: 'back to the settings',
    barsHelp: 'this help',
    cache: 'cache state, cost of the next message, settings',
    cacheTtl: 'cache duration: 5 or 60 min, auto = measured',
    cacheWarn: 'question before a cold send in a big chat',
    cacheHints: 'notice shortly before the cache expires',
    cacheBig: 'from what context a chat counts as big, e.g. 150k',
    handoff: 'write a handoff, then clear the chat and continue with it',
    handoffShow: 'print the last handoff',
    handoffContinue: 'clear the chat and continue with the last handoff',
    keepwarm: 'keep the cache warm, default 2 h, at most 4 h (costs quota)',
    keepwarmOff: 'stop keep-warm',
    disk: 'drive usage by file type; Windows only, needs storagePath; refresh scans again',
    skill: 'starts on "handoff", "wrap up the chat" …; /handoff uses it',
    skillCmd: 'skill uebergabe',
    aliases: 'Also accepted: /bars ? = help · /bars status · show = zeigen · reset = zurücksetzen, zuruecksetzen · an|aus · 5h = five, fivehour, 5hour, 5-hour · week = weekly, 7d, woche, wochenlimit · storage = disk, speicher · /cache warn = warnung, guard · hints = hinweise, alerts · big = groß, gross · /handoff zeigen|weiter · /keepwarm aus',
    fiveHour: '5-hour bar',
    weekly: 'Weekly bar',
    cacheRing: 'Cache ring',
    storageRing: 'Storage ring',
    byCommand: 'by /bars',
    bySetting: 'by setting',
    noPath: 'no storagePath',
    noDrive: 'no drive letter',
    setPath: 'setting storagePath',
    guard: 'Question before cold send',
    alerts: 'Notice before expiry',
    big: 'Threshold "big"',
    ttl: 'Cache duration',
    ttlAuto: (min: string, src: string) => `auto · ${min} min${src ? ` ${src}` : ''}`,
    ttlSet: (min: string) => `${min} min`,
    keep: 'Keep-warm',
    keepUntil: (at: string) => `until ${at}`,
    keepToggle: '/keepwarm [hours]',
    empty: 'empty = off',
    settings: {
      language: 'Language',
      resetStyle: 'Reset display',
      highlightAt: 'Highlight from (%)',
      showFiveHour: 'Show 5-hour bar',
      showWeekly: 'Show weekly bar',
      showCache: 'Show cache ring',
      showStorage: 'Show storage ring',
      onlyFiveHour: '5-hour limit only (deprecated)',
      storagePath: 'Storage drive',
    },
    footerTerminal: 'Change settings: /plugin configure limit-bars · Turn the mod off: /plugin disable limit-bars',
    footerDesktop: 'Turn the mod off: + → Plugins → Manage plugins · Change settings: /plugin configure limit-bars in a terminal',
  },
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
  unknownArg: (arg, possible) => `Unbekannt: „${arg}“. Möglich: ${possible} → \`/bars help\``,

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
  keepUsage: (max) => `Aufruf: /keepwarm [stunden|off], höchstens ${max} h. → \`/bars help\``,
  keepNothing: 'Noch keine Anfrage in diesem Chat, also nichts warmzuhalten.',
  keepCold: 'Der Cache ist schon kalt. Warmhalten würde ihn erst neu schreiben; die nächste Nachricht macht das ohnehin.',
  keepOn: (until, capped, lead, perPing, ctx, pings) =>
    `Warmhalten an bis ${until}${capped}. Ein Ping liest den Cache etwa ${lead} vor Ablauf: ${perPing} API-Wert je Ping bei ${ctx} Kontext, ` +
    `also etwa ${pings} Pings. Schreibt ein Ping neu statt zu lesen, schaltet es sich ab. Aus: /keepwarm off`,
  keepCapped: (max) => ` (höchstens ${max} h)`,

  diskAlt: (drive, used, total) => `Laufwerk ${drive} ${used} von ${total} belegt`,
  groups: {
    programs: 'Programme & Bibliotheken',
    media: 'Medien',
    models: 'KI-Modelle & Daten',
    code: 'Code & Text',
    archives: 'Archive & Pakete',
    other: 'Sonstiges',
  },
  diskFree: 'Frei',
  cmdStorage: 'Belegung des Laufwerks nach Dateiart: Ring mit Legende',
  storageOff: 'Der Speicher-Ring ist aus. In /config `storagePath` setzen, zum Beispiel `E:\\`.',
  storageWindowsOnly: 'Der Speicher-Ring geht vorerst nur unter Windows: `storagePath` braucht einen Laufwerksbuchstaben, zum Beispiel `E:\\`.',
  storageFailed: (drive, err) => `Laufwerk ${drive} nicht lesbar: ${err}`,
  storageScanFailed: (err) => `Scan fehlgeschlagen (${err}), angezeigt wird der letzte Stand.`,
  storageTitle: (drive, used, total, pct) => `### Laufwerk ${drive} · ${used} von ${total} belegt (${pct})`,
  storageScanned: (at, files) => `Gescannt ${at} · ${files} Dateien`,
  storageNoScan: 'Noch nicht nach Dateiart gescannt.',
  storageHead: '| Dateiart | Größe | Anteil |',
  storageOfDrive: (pct) => `${pct} des Laufwerks`,
  storageScanRunning: (at) => `Eine andere Sitzung scannt das Laufwerk seit ${at}. Gleich noch einmal /disk aufrufen.`,
  storageScanPaused: (at) => `Der letzte Scan ist um ${at} gescheitert; automatische Scans pausieren 24 h. Neu versuchen: /disk refresh`,
  errMissing: 'Pfad nicht gefunden',
  errUnreadable: 'Ordner nicht lesbar',
  errTruncated: 'Ausgabe abgeschnitten',
  errNoData: 'keine verwertbare Ausgabe',

  cmdBars: 'Teile der Anzeige ein- oder ausblenden: 5h, Woche, Cache, Speicher',
  barsTitle: '### limit-bars · Anzeige',
  barsHead: '| Teil | Sichtbar | Gesetzt durch |',
  barsPart: { fiveHour: '5-Stunden-Balken', weekly: 'Wochen-Balken', cache: 'Cache-Ring', storage: 'Speicher-Ring' },
  barsOn: 'an',
  barsOff: 'aus',
  barsByCommand: '/bars',
  barsBySetting: 'Einstellung',
  barsNoPath: 'an, aber ohne `storagePath`',
  barsNotWindows: 'an, aber `storagePath` ohne Laufwerksbuchstaben',
  barsUsage: 'Ändern: `/bars show 5h|week|cache|storage on|off` · zurück zu den Einstellungen: `/bars reset`. Wirkt in allen offenen Chats innerhalb von 10 s.',
  barsSet: (part, state) => `${part}: ${state}. Wirkt in allen offenen Chats innerhalb von 10 s; \`/bars reset\` geht zurück zu den Einstellungen.`,
  barsReset: 'Zurück zu den Einstellungen (`/config` → limit-bars).',
  barsCacheNote: 'Die Rückfrage vor kaltem Senden und die Hinweise bleiben; aus mit `/cache warn off` und `/cache hints off`.',
  barsSaveFailed: (err) => `Nicht gespeichert (${err}); gilt nur in diesem Chat bis zum Neustart.`,

  seeHelp: 'Alle Befehle: `/bars help`',
  help: {
    intro: 'Limits als Balken über dem Prompt, ein Ring für den Prompt-Cache und ein optionaler Speicher-Ring. Die Cache-Wache fragt vor einem teuren kalten Senden.',
    bars: 'welche Teile der Anzeige zu sehen sind',
    barsShow: 'Teil ein- oder ausblenden, in allen offenen Chats binnen 10 s (auch ohne show)',
    barsReset: 'zurück zu den Einstellungen',
    barsHelp: 'diese Hilfe',
    cache: 'Zustand des Caches, Kosten der nächsten Nachricht, Einstellungen',
    cacheTtl: 'Cache-Dauer: 5 oder 60 min, auto = gemessen',
    cacheWarn: 'Rückfrage vor kaltem Senden in einem großen Chat',
    cacheHints: 'Hinweis kurz bevor der Cache abläuft',
    cacheBig: 'ab welchem Kontext ein Chat als groß gilt, z. B. 150k',
    handoff: 'Übergabe schreiben, danach Chat leeren und damit weitermachen',
    handoffShow: 'letzte Übergabe ausgeben',
    handoffContinue: 'Chat leeren und mit der letzten Übergabe weitermachen',
    keepwarm: 'Cache warmhalten, Standard 2 h, höchstens 4 h (kostet Kontingent)',
    keepwarmOff: 'Warmhalten beenden',
    disk: 'Belegung nach Dateiart; nur Windows, braucht storagePath; refresh scannt neu',
    skill: 'startet bei „Übergabe“, „Chat abschließen“ …; /handoff nutzt ihn',
    skillCmd: 'Skill uebergabe',
    aliases: 'Auch erkannt: /bars ? = help · /bars status · show = zeigen · reset = zurücksetzen, zuruecksetzen · an|aus · 5h = five, fivehour, 5hour, 5-hour · week = weekly, 7d, woche, wochenlimit · storage = disk, speicher · /cache warn = warnung, guard · hints = hinweise, alerts · big = groß, gross · /handoff zeigen|weiter · /keepwarm aus',
    fiveHour: '5-Stunden-Balken',
    weekly: 'Wochen-Balken',
    cacheRing: 'Cache-Ring',
    storageRing: 'Speicher-Ring',
    byCommand: 'per Befehl',
    bySetting: 'per Einstellung',
    noPath: 'ohne storagePath',
    noDrive: 'ohne Laufwerksbuchstaben',
    setPath: 'Einstellung storagePath',
    guard: 'Rückfrage vor kaltem Senden',
    alerts: 'Hinweis vor Ablauf',
    big: 'Schwelle „groß“',
    ttl: 'Cache-Dauer',
    ttlAuto: (min, src) => `auto · ${min} min${src ? ` ${src}` : ''}`,
    ttlSet: (min) => `${min} min`,
    keep: 'Warmhalten',
    keepUntil: (at) => `bis ${at}`,
    keepToggle: '/keepwarm [stunden]',
    empty: 'leer = aus',
    settings: {
      language: 'Sprache',
      resetStyle: 'Reset-Anzeige',
      highlightAt: 'Hervorheben ab (%)',
      showFiveHour: '5-Stunden-Balken zeigen',
      showWeekly: 'Wochen-Balken zeigen',
      showCache: 'Cache-Ring zeigen',
      showStorage: 'Speicher-Ring zeigen',
      onlyFiveHour: 'Nur 5-Stunden-Limit (veraltet)',
      storagePath: 'Speicher-Laufwerk',
    },
    footerTerminal: 'Einstellungen ändern: /plugin configure limit-bars · Mod abschalten: /plugin disable limit-bars',
    footerDesktop: 'Mod abschalten: + → Plugins → Manage plugins · Einstellungen ändern: im Terminal /plugin configure limit-bars',
  },
}

export const T: Readonly<Record<Lang, Texts>> = { en, de }

/** Einstellungen von `/cache`, in Hilfe und Karte immer in der englischen Form (deutsche Aliase: cache.ts `applySetting`). */
export const CACHE_ARGS = 'ttl 5|60|auto · warn on|off · big 150k · hints on|off'
export const CACHE_HINT = '[ttl 5|60|auto] [warn on|off] [big 150k] [hints on|off]'
export const HANDOFF_HINT = '[continue|show]'
export const BARS_HINT = '[show 5h|week|cache|storage on|off] [reset] [help]'
